// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

interface ISubDynamicStrategy {
    function skim(uint256 amount) external;
    function harvest() external returns (uint256 amountAdded);
    function withdraw(uint256 amount) external returns (uint256 actualAmount);
    function exit() external returns (uint256 amountAdded);

    function enter() external;
    function leave() external;
}