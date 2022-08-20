// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

interface IRouter {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        external
        payable
        returns (
            uint256 amountToken,
            uint256 amountETH,
            uint256 liquidity
        );
}

contract TrophyIDO is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    IRouter public immutable ROUTER;
    uint256 public RATE_PRECISION_FACTOR = 1000;

    IERC20 public token;
    uint256 public price;
    uint256 public listingPrice;
    uint256 public minPurchase;
    uint256 public maxPurchase;
    uint256 public startTime;
    uint256 public endTime;
    uint256 public lpPercent;

    enum SaleStatus {
        STARTED,
        FINALIZED,
        CANCELED
    }
    SaleStatus public status;

    struct PurchaseDetail {
        address purchaser;
        uint256 amount;
        bool isClaimed;
    }

    mapping(address => PurchaseDetail) public purchaseDetails;
    address[] public purchasers;
    uint256 public currentCap;
    uint256 public hardCap;

    event Purchased(address indexed purchaser, uint256 amount);
    event Claimed(address indexed purchaser, uint256 amount);
    event Refunded(address indexed purchaser, uint256 amount);
    event FinalizedSale();
    event CanceledSale();

    constructor(
        address _token,
        uint256 _price,
        uint256 _listingPrice,
        uint256 _minPurchase,
        uint256 _maxPurchase,
        uint256 _hardCap,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _lpPercent,
        address _router
    ) {
        token = IERC20(_token);
        price = _price;
        listingPrice = _listingPrice;
        minPurchase = _minPurchase;
        maxPurchase = _maxPurchase;
        hardCap = _hardCap;

        startTime = _startTime;
        endTime = _endTime;
        lpPercent = _lpPercent;

        ROUTER = IRouter(_router);
    }

    modifier occurring() {
        require(
            block.timestamp >= startTime &&
                block.timestamp <= endTime &&
                status == SaleStatus.STARTED,
            "NOT_OCCURRING"
        );
        _;
    }

    modifier underHardCap() {
        require(currentCap < hardCap, "MET_HARD_CAP");
        _;
    }

    modifier validAmount(uint256 amount) {
        require(
            amount >= minPurchase && amount <= maxPurchase,
            "INVALID_AMOUNT"
        );
        _;
    }

    modifier whenFinalized() {
        require(status == SaleStatus.FINALIZED, "NOT_FINALIZED_YET");
        _;
    }

    modifier whenCanceled() {
        require(status == SaleStatus.CANCELED, "NOT_CANCELED");
        _;
    }

    function setTime(uint256 _startTime, uint256 _endTime) external onlyOwner {
        startTime = _startTime;
        endTime = _endTime;
    }

    function getAllPurchasers() public view returns (PurchaseDetail[] memory) {
        uint256 length = purchasers.length;
        PurchaseDetail[] memory allPurchasers = new PurchaseDetail[](length);

        for (uint8 i = 0; i < length; i++) {
            allPurchasers[i] = purchaseDetails[purchasers[i]];
        }

        return allPurchasers;
    }

    function purchase()
        external
        payable
        occurring
        validAmount(msg.value)
        underHardCap
    {
        PurchaseDetail memory purchaseDetail = purchaseDetails[msg.sender];
        require(purchaseDetail.amount == 0, "ALREADY_PURCHASED");

        uint256 amount = msg.value;
        currentCap = currentCap.add(amount);
        if (purchaseDetail.amount == 0) {
            purchaseDetails[msg.sender].purchaser = msg.sender;
            purchasers.push(msg.sender);
        }
        purchaseDetails[msg.sender].amount = purchaseDetail.amount.add(amount);

        emit Purchased(msg.sender, amount);
    }

    function calcTotalTokensRequired() public view returns (uint256) {
        return
            currentCap.mul(1 ether).div(price).add(
                currentCap
                    .mul(lpPercent)
                    .div(RATE_PRECISION_FACTOR)
                    .mul(1 ether)
                    .div(listingPrice)
            );
    }

    function finalize(address _to) external onlyOwner {
        require(status == SaleStatus.STARTED, "ALREADY_FINALIZED_OR_CANCELED");
        status = SaleStatus.FINALIZED;

        // for liquidity
        uint256 ethLiqAmount = currentCap.mul(lpPercent).div(
            RATE_PRECISION_FACTOR
        );
        uint256 tokenLiqAmount = ethLiqAmount.mul(1 ether).div(listingPrice);

        token.approve(address(ROUTER), tokenLiqAmount);

        ROUTER.addLiquidityETH{value: ethLiqAmount}(
            address(token),
            tokenLiqAmount,
            0,
            0,
            _to,
            block.timestamp
        );

        // for project
        payable(_to).transfer(currentCap.sub(ethLiqAmount));

        emit FinalizedSale();
    }

    function cancelSale() external onlyOwner {
        require(status == SaleStatus.STARTED, "ALREADY_CANCELED_OR_FINALIZED");
        status = SaleStatus.CANCELED;

        emit CanceledSale();
    }

    function refund() external whenCanceled nonReentrant {
        PurchaseDetail memory purchaseDetail = purchaseDetails[msg.sender];
        require(
            purchaseDetail.amount > 0 && !purchaseDetail.isClaimed,
            "INVALID_ACTION"
        );

        purchaseDetails[msg.sender].isClaimed = true;
        payable(msg.sender).transfer(purchaseDetail.amount);

        emit Refunded(msg.sender, purchaseDetail.amount);
    }

    function claim() external whenFinalized {
        PurchaseDetail memory purchaseDetail = purchaseDetails[msg.sender];
        require(
            purchaseDetail.amount > 0 && !purchaseDetail.isClaimed,
            "INVALID_ACTION"
        );

        purchaseDetails[msg.sender].isClaimed = true;

        // uint256 currentRate = calcCurrentRate();
        uint256 claimAmount = purchaseDetail.amount.mul(1 ether).div(price);

        token.transfer(msg.sender, claimAmount);

        emit Claimed(msg.sender, claimAmount);
    }
}
