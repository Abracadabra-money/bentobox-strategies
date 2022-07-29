// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.7;

import "solmate/src/tokens/ERC20.sol";
import "./BaseStargateLPStrategy.sol";
import "../../interfaces/curve/ICurvePool.sol";
import "../../interfaces/curve/ICurveThreePool.sol";
import "../../interfaces/Tether.sol";

contract MainnetUsdtStargateLPStrategy is BaseStargateLPStrategy {
    ICurvePool public constant STGPOOL = ICurvePool(0x3211C6cBeF1429da3D0d58494938299C92Ad5860);
    ICurveThreePool public constant THREEPOOL = ICurveThreePool(0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7);
    ERC20 public constant USDC = ERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    Tether public constant USDT = Tether(0xdAC17F958D2ee523a2206206994597C13D831ec7);

    constructor(
        address _strategyToken,
        address _bentoBox,
        IStargateRouter _router,
        uint256 _poolId,
        ILPStaking _staking,
        uint256 _pid
    ) BaseStargateLPStrategy(_strategyToken, _bentoBox, _router, _poolId, _staking, _pid) {
        IStargateToken(_staking.stargate()).approve(address(STGPOOL), type(uint256).max);
        USDC.approve(address(THREEPOOL), type(uint256).max);
    }

    function _swapToUnderlying(uint256 stgBalance) internal override {
        // STG -> USDC
        STGPOOL.exchange(0, 1, stgBalance, 0);

        // USDC -> USDT
        THREEPOOL.exchange(1, 2, USDC.balanceOf(address(this)), 0);
    }
}
