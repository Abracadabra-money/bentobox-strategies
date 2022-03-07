// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "../interfaces/IStrategy.sol";
import "../interfaces/IBentoBoxMinimal.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IExchangeRateFeeder {
    function exchangeRateOf(
        address _token,
        bool _simulate
    ) external view returns (uint256);
}

interface IUSTStrategy {
    function feeder() external view returns (IExchangeRateFeeder);
    function safeWithdraw(uint256 amount) external;
    function safeHarvest(uint256 maxBalance, bool rebalance, uint256 maxChangeAmount, bool harvestRewards) external;
}


contract USTMiddleLayer {    
    using SafeERC20 for IERC20;

    IERC20 public constant UST = IERC20(0xa47c8bf37f92aBed4A126BDA807A7b7498661acD);
    IERC20 public constant aUST = IERC20(0xa8De3e3c934e2A1BB08B010104CcaBBD4D6293ab);
    IUSTStrategy private constant strategy = IUSTStrategy(0xE6191aA754F9a881e0a73F2028eDF324242F39E2);
    IBentoBoxMinimal private constant bentoBox = IBentoBoxMinimal(0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce);

    uint256 public lastWithdraw;

    function accountEarnings() external {
        uint256 balance = IBentoBoxMinimal(bentoBox).strategyData(address(UST)).balance;
        uint256 exchangeRate = strategy.feeder().exchangeRateOf(address(UST), true);
        uint256 keep = balance;
        uint256 liquid = UST.balanceOf(address(strategy));
        uint256 total = toUST(aUST.balanceOf(address(strategy)), exchangeRate) + liquid;

        require(total > keep, "Strategy would account a loss");

        strategy.safeHarvest(type(uint256).max, false, type(uint256).max, false);
    }

    function redeemEarningsImproved() external {
        require(lastWithdraw + 20 minutes < block.timestamp);

        uint256 balance = IBentoBoxMinimal(bentoBox).strategyData(address(UST)).balance;
        uint256 exchangeRate = strategy.feeder().exchangeRateOf(address(UST), true);
        uint256 keep = balance;
        uint256 liquid = UST.balanceOf(address(strategy));
        uint256 total = toUST(aUST.balanceOf(address(strategy)), exchangeRate) + liquid;

        lastWithdraw = block.timestamp;

        if (total > keep) strategy.safeWithdraw(total - keep - liquid);
    }

    function toUST(uint256 amount, uint256 exchangeRate) public pure returns (uint256) {
        return amount * exchangeRate / 1e18;
    }

    function toAUST(uint256 amount, uint256 exchangeRate) public pure returns (uint256) {
        return amount * 1e18 / exchangeRate;
    }
}