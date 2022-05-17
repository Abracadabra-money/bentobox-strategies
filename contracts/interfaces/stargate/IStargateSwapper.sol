// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.6.12;

interface IStargateSwapper {
    function swapToUnderlying(uint256 stgAmount, address recipient) external;
}
