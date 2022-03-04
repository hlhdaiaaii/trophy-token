// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

interface IPancakeRouter {
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

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

    function factory() external pure returns (address);

    function WETH() external pure returns (address);
}

interface IPancakeFactory {
    function createPair(address tokenA, address tokenB)
        external
        returns (address pair);
}

contract TrophyToken is ERC20, Ownable {
    using SafeMath for uint256;
    uint256 public constant PRECISION_RATE = 100000; // e.g. 5000 = 5%

    mapping(address => bool) public feeTos;
    address[] public feeToList;
    mapping(address => uint256) public feePercents;

    mapping(address => bool) public excludedFromFee;
    address[] public excludedFromFeeList;

    uint256 public burnFeePercent;
    address public immutable BURN_ADDRESS;

    uint256 public liquidifyPercent;
    address public lpTo;
    address public pair;
    IPancakeRouter public router;

    receive() external payable {}

    constructor(
        address _router,
        address _lpTo,
        uint256 _liquidifyPercent,
        uint256 _burnFeePercent,
        address _burnAddress,
        address[] memory _feeTos,
        uint256[] memory _feePercents
    ) ERC20("Trophy Token", "TRT") {
        router = IPancakeRouter(_router);

        // Create a uniswap pair for this new token
        pair = IPancakeFactory(router.factory()).createPair(
            address(this),
            router.WETH()
        );
        liquidifyPercent = _liquidifyPercent;
        lpTo = _lpTo;
        uint256 MAX_UINT = ~uint256(0);
        _approve(address(this), address(router), MAX_UINT);

        burnFeePercent = _burnFeePercent;
        BURN_ADDRESS = _burnAddress;

        for (uint256 i = 0; i < _feeTos.length; i++) {
            addFeeTo(_feeTos[i], _feePercents[i]);
        }

        addExcludedFromFee(msg.sender);
        addExcludedFromFee(address(this));
    }

    function addFeeTo(address _feeTo, uint256 feePercent) public onlyOwner {
        require(!feeTos[_feeTo], "TRT: feeTo already added");
        payable(_feeTo).transfer(0); // check if address can receive eth
        feeTos[_feeTo] = true;
        feeToList.push(_feeTo);
        feePercents[_feeTo] = feePercent;
    }

    function removeFeeTo(address _feeTo) public onlyOwner {
        require(feeTos[_feeTo], "TRT: feeTo not added");

        for (uint256 i = 0; i < feeToList.length; i++) {
            if (feeToList[i] == _feeTo) {
                feeToList[i] = feeToList[feeToList.length - 1];
                feeToList.pop();

                feeTos[_feeTo] = false;
                break;
            }
        }
    }

    function getFeeToList() public view returns (address[] memory) {
        return feeToList;
    }

    function addExcludedFromFee(address _account) public onlyOwner {
        require(!excludedFromFee[_account], "TRT: account already excluded");
        excludedFromFee[_account] = true;
        excludedFromFeeList.push(_account);
    }

    function removeExcludedFromFee(address _account) public onlyOwner {
        require(excludedFromFee[_account], "TRT: account not excluded");

        for (uint256 i = 0; i < excludedFromFeeList.length; i++) {
            if (excludedFromFeeList[i] == _account) {
                excludedFromFeeList[i] = excludedFromFeeList[
                    excludedFromFeeList.length - 1
                ];
                excludedFromFeeList.pop();

                excludedFromFee[_account] = false;
                break;
            }
        }
    }

    function getExcludedFromFeeList() public view returns (address[] memory) {
        return excludedFromFeeList;
    }

    function addLiquidity(uint256 tokenAmount, uint256 ethAmount) private {
        router.addLiquidityETH{value: ethAmount}(
            address(this),
            tokenAmount,
            0, // slippage is unavoidable
            0, // slippage is unavoidable
            lpTo,
            block.timestamp
        );
    }

    function swapTokensForEth(uint256 tokenAmount) private {
        // generate the uniswap pair path of token -> weth
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = router.WETH();

        // make the swap
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0, // accept any amount of ETH
            path,
            address(this),
            block.timestamp
        );
    }

    //
    function calcTotalFeeToPercent() public view returns (uint256) {
        uint256 totalFeePercent = 0;
        for (uint256 i = 0; i < feeToList.length; i++) {
            totalFeePercent = totalFeePercent.add(feePercents[feeToList[i]]);
        }
        return totalFeePercent;
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        uint256 totalFeeAmount;

        if (
            to == pair && // transfer to the uniswap pair, could be sell or add liquidity transaction
            !excludedFromFee[from] // not excluded from fee
        ) {
            uint256 totalFeeToPercent = calcTotalFeeToPercent();
            uint256 totalFeeToAmount = amount.mul(totalFeeToPercent).div(
                PRECISION_RATE
            );

            uint256 totalFeePercent = totalFeeToPercent.add(burnFeePercent).add(
                liquidifyPercent
            );
            totalFeeAmount = amount.mul(totalFeePercent).div(PRECISION_RATE);

            // scope to avoid stack too deep errors
            {
                uint256 burnFeeAmount = amount.mul(burnFeePercent).div(
                    PRECISION_RATE
                );
                super._transfer(
                    from,
                    address(this),
                    totalFeeAmount.sub(burnFeeAmount)
                );
                super._transfer(from, BURN_ADDRESS, burnFeeAmount);
            }

            uint256 halfLiquidifyPercent = liquidifyPercent.div(2);
            uint256 halfLiquidifyAmount = amount.mul(halfLiquidifyPercent).div(
                PRECISION_RATE
            );

            uint256 otherHalfLiquidifyPercent = liquidifyPercent.sub(
                halfLiquidifyPercent
            );
            uint256 otherHalfLiquidifyAmount = amount
                .mul(otherHalfLiquidifyPercent)
                .div(PRECISION_RATE);

            uint256 tokenAmountForSwap = totalFeeToAmount.add(
                halfLiquidifyAmount
            );
            uint256 initialEth = address(this).balance;
            swapTokensForEth(tokenAmountForSwap);
            uint256 gainedEth = address(this).balance.sub(initialEth);
            uint256 ethForLiquidify = gainedEth.mul(halfLiquidifyPercent).div(
                totalFeeToPercent.add(halfLiquidifyPercent)
            );
            addLiquidity(otherHalfLiquidifyAmount, ethForLiquidify);
            uint256 gainedEthForFeeTos = gainedEth.sub(ethForLiquidify);
            // distribute fee to feeToList
            uint256 distributeSoFar = 0;
            for (uint256 i = 0; i < feeToList.length; i++) {
                if (i == feeToList.length - 1) {
                    payable(feeToList[i]).transfer(
                        gainedEthForFeeTos.sub(distributeSoFar)
                    );
                } else {
                    uint256 transferAmount = gainedEthForFeeTos
                        .mul(feePercents[feeToList[i]])
                        .div(totalFeeToPercent);
                    payable(feeToList[i]).transfer(transferAmount);
                    distributeSoFar = distributeSoFar.add(transferAmount);
                }
            }
        }
        super._transfer(from, to, amount.sub(totalFeeAmount));
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function getEthBalance() public view returns (uint256) {
        return payable(address(this)).balance;
    }

    // collect any leftover dust from the contract
    function collectEthDust(address _to) public onlyOwner {
        uint256 ethDust = getEthBalance();
        payable(_to).transfer(ethDust);
    }

    function collectTokenDust(address _token, address _to) public onlyOwner {
        uint256 tokenDust = IERC20(_token).balanceOf(address(this));
        IERC20(_token).transfer(_to, tokenDust);
    }
}
