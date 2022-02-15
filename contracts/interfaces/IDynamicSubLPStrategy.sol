// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

interface IDynamicSubLPStrategy {
    function skim(uint256 amount) external;

    function harvest() external returns (uint256 amountAdded);

    function withdraw(uint256 amount) external returns (uint256 actualAmount);

    function exit() external returns (uint256 actualAmount);

    function getPairTokens() external view returns (address token0, address token1);

    function strategyToken() external view returns (address strategyToken);

    function wrap() external;

    function unwrap(IDynamicSubLPStrategy recipient) external;
}
