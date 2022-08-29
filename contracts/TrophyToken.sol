// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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
    uint256 public constant PRECISION_RATE = 100000; // e.g. 5000 = 5%

    mapping(address => bool) public feeTos;
    address[] public feeToList;
    mapping(address => uint256) public feePercents;

    mapping(address => bool) public excludedFromFee;
    address[] public excludedFromFeeList;

    uint256 public burnFeePercent;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 public liquidifyPercent;
    address public lpTo;

    // support for other pools
    mapping(address => bool) public pairs;
    // pair => router
    mapping(address => IPancakeRouter) public routers;

    receive() external payable {}

    constructor(
        address _router,
        address _lpTo,
        uint256 _liquidifyPercent,
        uint256 _burnFeePercent,
        address[] memory _feeTos,
        uint256[] memory _feePercents
    ) ERC20("Trophy Token", "TRT") {
        IPancakeRouter router = IPancakeRouter(_router);

        // Create a pancakeswap pair for this new token
        address pair = IPancakeFactory(router.factory()).createPair(
            address(this),
            router.WETH()
        );

        addPair(pair, _router);
        liquidifyPercent = _liquidifyPercent;
        lpTo = _lpTo;

        burnFeePercent = _burnFeePercent;

        for (uint256 i = 0; i < _feeTos.length; i++) {
            addFeeTo(_feeTos[i], _feePercents[i]);
        }

        addExcludedFromFee(msg.sender);
        addExcludedFromFee(address(this));
    }

    function addPair(address _pair, address _router) public onlyOwner {
        pairs[_pair] = true;
        routers[_pair] = IPancakeRouter(_router);

        uint256 MAX_UINT = ~uint256(0);
        _approve(address(this), address(_router), MAX_UINT);
    }

    function removePair(address _pair) public onlyOwner {
        pairs[_pair] = false;
    }

    function addFeeTo(address _feeTo, uint256 _feePercent) public onlyOwner {
        require(feeToList.length < 3, "TRT: reached max number of feeTos");
        require(!feeTos[_feeTo], "TRT: feeTo already added");
        payable(_feeTo).transfer(0); // check if address can receive eth
        feeTos[_feeTo] = true;
        feeToList.push(_feeTo);
        feePercents[_feeTo] = _feePercent;
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

    function addLiquidity(
        address pair,
        uint256 tokenAmount,
        uint256 ethAmount
    ) private {
        routers[pair].addLiquidityETH{value: ethAmount}(
            address(this),
            tokenAmount,
            0, // slippage is unavoidable
            0, // slippage is unavoidable
            lpTo,
            block.timestamp
        );
    }

    function swapTokensForEth(address _pair, uint256 _tokenAmount) private {
        // generate the pancake pair path of token -> weth
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = routers[_pair].WETH();

        // make the swap
        routers[_pair].swapExactTokensForETHSupportingFeeOnTransferTokens(
            _tokenAmount,
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
            totalFeePercent = totalFeePercent + feePercents[feeToList[i]];
        }
        return totalFeePercent;
    }

    function _transfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal override {
        // safety check for the very unlikely case
        // that someday someone figures out the private key of the burn address
        require(_from != BURN_ADDRESS, "BURN_ADDRESS can't transfer!");

        uint256 totalFeeAmount;
        if (
            pairs[_to] && !excludedFromFee[_from] // transfer to the pancakeswap pair, could be sell or add liquidity transaction // not excluded from fee
        ) {
            address pair = _to;
            uint256 totalFeeToPercent = calcTotalFeeToPercent();
            uint256 totalFeeToAmount = _amount * totalFeeToPercent /
                PRECISION_RATE;

            uint256 totalFeePercent = totalFeeToPercent +
                burnFeePercent +
                liquidifyPercent;
            totalFeeAmount = _amount * totalFeePercent / PRECISION_RATE;

            // scope to avoid stack too deep errors
            {
                uint256 burnFeeAmount = _amount * burnFeePercent /
                    PRECISION_RATE;
                super._transfer(
                    _from,
                    address(this),
                    totalFeeAmount - burnFeeAmount
                );
                super._transfer(_from, BURN_ADDRESS, burnFeeAmount);
            }

            uint256 halfLiquidifyPercent = liquidifyPercent / 2;
            uint256 halfLiquidifyAmount = _amount * halfLiquidifyPercent /
                PRECISION_RATE;

            uint256 otherHalfLiquidifyPercent = liquidifyPercent -
                halfLiquidifyPercent;
            uint256 otherHalfLiquidifyAmount = _amount *
                otherHalfLiquidifyPercent / PRECISION_RATE;

            uint256 tokenAmountForSwap = totalFeeToAmount + halfLiquidifyAmount;
            uint256 initialEth = address(this).balance;
            swapTokensForEth(pair, tokenAmountForSwap);
            uint256 gainedEth = address(this).balance - initialEth;
            uint256 ethForLiquidify = gainedEth * halfLiquidifyPercent /
                (totalFeeToPercent + halfLiquidifyPercent);
            addLiquidity(pair, otherHalfLiquidifyAmount, ethForLiquidify);
            uint256 gainedEthForFeeTos = gainedEth - ethForLiquidify;
            // distribute fee to feeToList
            uint256 distributeSoFar = 0;
            for (uint256 i = 0; i < feeToList.length; i++) {
                if (i == feeToList.length - 1) {
                    payable(feeToList[i]).transfer(
                        gainedEthForFeeTos - distributeSoFar
                    );
                } else {
                    uint256 transferAmount = gainedEthForFeeTos *
                        feePercents[feeToList[i]] / totalFeeToPercent;
                    payable(feeToList[i]).transfer(transferAmount);
                    distributeSoFar = distributeSoFar + transferAmount;
                }
            }
        }
        super._transfer(_from, _to, _amount - totalFeeAmount);
    }

    function mint(address _to, uint256 _amount) external onlyOwner {
        _mint(_to, _amount);
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
