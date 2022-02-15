// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "./IOracle.sol";

interface IDynamicSubLPStrategy {
    function skim(uint256 amount) external;

    function harvest() external returns (uint256 amountAdded);

    function withdraw(uint256 amount) external returns (uint256 actualAmount);

    function exit() external returns (uint256 actualAmount);

    function getPairTokens() external view returns (address token0, address token1);

    function strategyToken() external view returns (address);

    function oracle() external view returns (IOracle);

    function wrapAndDeposit() external returns (uint256 amount);

    function withdrawAndUnwrapTo(IDynamicSubLPStrategy recipient) external returns (uint256 amount);

    function swapToLP(
        uint256 amountOutMin,
        uint256 feePercent,
        address feeTo
    ) external returns (uint256 amountOut);
}
