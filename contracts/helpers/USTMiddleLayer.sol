// SPDX-License-Identifier: GPL-3.0-or-later
// solhint-disable const-name-snakecase

pragma solidity 0.8.7;

import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "../interfaces/IStrategy.sol";
import "../interfaces/IBentoBoxMinimal.sol";

interface IExchangeRateFeeder {
    function exchangeRateOf(address _token, bool _simulate) external view returns (uint256);
}

interface IUSTStrategy {
    function feeder() external view returns (IExchangeRateFeeder);

    function safeWithdraw(uint256 amount) external;

    function safeHarvest(
        uint256 maxBalance,
        bool rebalance,
        uint256 maxChangeAmount,
        bool harvestRewards
    ) external;
}

contract USTMiddleLayer {
    using SafeTransferLib for ERC20;

    error YieldNotHighEnough();
    error StrategyWouldAccountLoss();

    ERC20 public constant UST = ERC20(0xa47c8bf37f92aBed4A126BDA807A7b7498661acD);
    ERC20 public constant aUST = ERC20(0xa8De3e3c934e2A1BB08B010104CcaBBD4D6293ab);
    IUSTStrategy private constant strategy = IUSTStrategy(0xE0C29b1A278D4B5EAE5016A7bC9bfee6c663D146);
    IBentoBoxMinimal private constant bentoBox = IBentoBoxMinimal(0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce);

    function accountEarnings() external {
        uint256 balanceToKeep = IBentoBoxMinimal(bentoBox).strategyData(address(UST)).balance;
        uint256 exchangeRate = strategy.feeder().exchangeRateOf(address(UST), true);
        uint256 liquid = UST.balanceOf(address(strategy));
        uint256 total = toUST(aUST.balanceOf(address(strategy)), exchangeRate) + liquid;

        if (total <= balanceToKeep) {
            revert StrategyWouldAccountLoss();
        }

        if (liquid <= 100 ether) {
            revert YieldNotHighEnough();
        }

        strategy.safeHarvest(type(uint256).max, false, type(uint256).max, false);
    }

    function redeemEarningsImproved() external {
        uint256 balanceToKeep = IBentoBoxMinimal(bentoBox).strategyData(address(UST)).balance;
        uint256 exchangeRate = strategy.feeder().exchangeRateOf(address(UST), true);
        uint256 liquid = UST.balanceOf(address(strategy));
        uint256 total = toUST(aUST.balanceOf(address(strategy)), exchangeRate) + liquid;

        if (total <= balanceToKeep) {
            revert StrategyWouldAccountLoss();
        }

        if (total - balanceToKeep <= 100 ether) {
            revert YieldNotHighEnough();
        }

        strategy.safeWithdraw(total - balanceToKeep - liquid);
    }

    function toUST(uint256 amount, uint256 exchangeRate) public pure returns (uint256) {
        return (amount * exchangeRate) / 1e18;
    }

    function toAUST(uint256 amount, uint256 exchangeRate) public pure returns (uint256) {
        return (amount * 1e18) / exchangeRate;
    }
}
