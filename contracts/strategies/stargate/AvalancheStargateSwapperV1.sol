// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.7;

import "solmate/src/tokens/ERC20.sol";
import "../../interfaces/stargate/IStargateSwapper.sol";

interface JoeRouter02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract AvalancheStargateSwapperV1 is IStargateSwapper {
    JoeRouter02 public constant ROUTER = JoeRouter02(0x60aE616a2155Ee3d9A68541Ba4544862310933d4);
    ERC20 public constant STARGATE = ERC20(0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590);

    address[] public path;

    constructor(address[] memory _path) {
        for (uint256 i = 0; i < _path.length; i++) {
            path.push(_path[i]);
        }

        STARGATE.approve(address(ROUTER), type(uint256).max);
    }

    function swapToUnderlying(uint256 stgBalance, address recipient) external override {
        STARGATE.transferFrom(msg.sender, address(this), stgBalance);
        ROUTER.swapExactTokensForTokens(stgBalance, 0, path, recipient, type(uint256).max);
    }
}
