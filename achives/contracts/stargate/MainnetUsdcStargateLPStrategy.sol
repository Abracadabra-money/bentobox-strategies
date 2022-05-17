// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.7;

import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "./BaseStargateLPStrategy.sol";
import "../../interfaces/curve/ICurvePool.sol";

contract MainnetUsdcStargateLPStrategy is BaseStargateLPStrategy {
    ICurvePool public constant STGPOOL = ICurvePool(0x3211C6cBeF1429da3D0d58494938299C92Ad5860);
    ERC20 public constant USDC = ERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    constructor(
        address _strategyToken,
        address _bentoBox,
        IStargateRouter _router,
        uint256 _poolId,
        ILPStaking _staking,
        uint256 _pid
    ) BaseStargateLPStrategy(_strategyToken, _bentoBox, _router, _poolId, _staking, _pid) {
        IStargateToken(_staking.stargate()).approve(address(STGPOOL), type(uint256).max);
    }

    function _swapToUnderlying(uint256 stgBalance) internal override {
        // STG -> USDC
        STGPOOL.exchange(0, 1, stgBalance, 0);
    }
}
