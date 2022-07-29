// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.7;

import "solmate/src/tokens/ERC20.sol";
import "../../interfaces/stargate/IStargateSwapper.sol";
import "../../interfaces/balancer/IBalancerVault.sol";

contract ArbitrumStargateUsdtSwapperV1 is IStargateSwapper {
    IBalancerVault public constant VAULT = IBalancerVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    address public constant USDC = 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8;
    address public constant USDT = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9;
    ERC20 public constant STARGATE = ERC20(0x6694340fc020c5E6B96567843da2df01b2CE1eb6);

    constructor() {
        STARGATE.approve(address(VAULT), type(uint256).max);
    }

    function swapToUnderlying(uint256 stgBalance, address recipient) external override {
        STARGATE.transferFrom(msg.sender, address(this), stgBalance);

        IBalancerVault.BatchSwapStep[] memory swaps = new IBalancerVault.BatchSwapStep[](2);
        swaps[0] = IBalancerVault.BatchSwapStep({
            poolId: 0x3a4c6d2404b5eb14915041e01f63200a82f4a343000200000000000000000065, // STG/USDC PoolId
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: stgBalance,
            userData: ""
        });
        swaps[1] = IBalancerVault.BatchSwapStep({
            poolId: 0x1533a3278f3f9141d5f820a184ea4b017fce2382000000000000000000000016, // USDC/USDT/DAI PoolId
            assetInIndex: 1,
            assetOutIndex: 2,
            amount: 0,
            userData: ""
        });

        address[] memory assets = new address[](3);
        assets[0] = address(STARGATE);
        assets[1] = USDC;
        assets[2] = USDT;

        IBalancerVault.FundManagement memory funds = IBalancerVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(recipient),
            toInternalBalance: false
        });

        int256[] memory limits = new int256[](3);

        limits[0] = int256(stgBalance);
        limits[1] = 0;
        limits[2] = 0;

        // STG -> USDT
        VAULT.batchSwap(IBalancerVault.SwapKind.GIVEN_IN, swaps, assets, funds, limits, type(uint256).max);
    }
}
