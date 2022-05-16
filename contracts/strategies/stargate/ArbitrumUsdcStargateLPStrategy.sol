// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.7;

import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "./BaseStargateLPStrategy.sol";
import "../../interfaces/balancer/IBalancerVault.sol";

contract ArbitrumUsdcStargateLPStrategy is BaseStargateLPStrategy {
    IBalancerVault public constant VAULT = IBalancerVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    address public constant USDC = 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8;

    constructor(
        address _strategyToken,
        address _bentoBox,
        IStargateRouter _router,
        uint256 _poolId,
        ILPStaking _staking,
        uint256 _pid
    ) BaseStargateLPStrategy(_strategyToken, _bentoBox, _router, _poolId, _staking, _pid) {
        IStargateToken(_staking.stargate()).approve(address(VAULT), type(uint256).max);
    }

    function _swapToUnderlying(uint256 stgBalance) internal override {
        IBalancerVault.BatchSwapStep[] memory swaps = new IBalancerVault.BatchSwapStep[](1);
        swaps[0] = IBalancerVault.BatchSwapStep({
            poolId: 0x3a4c6d2404b5eb14915041e01f63200a82f4a343000200000000000000000065, // STG/USDC PoolId
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: stgBalance,
            userData: ""
        });

        address[] memory assets = new address[](2);
        assets[0] = address(stargateToken);
        assets[1] = USDC;

        IBalancerVault.FundManagement memory funds = IBalancerVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });

        int256[] memory limits = new int256[](2);

        limits[0] = int256(stgBalance);
        limits[1] = 0;

        // STG -> USDC
        VAULT.batchSwap(IBalancerVault.SwapKind.GIVEN_IN, swaps, assets, funds, limits, type(uint256).max);
    }
}
