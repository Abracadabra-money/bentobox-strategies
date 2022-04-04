// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.7;

interface ISpiritSwapGauge {
    function depositAll() external;
    function deposit(uint256 amount) external;
    function depositFor(uint256 amount, address account) external;
    function getReward() external;
}