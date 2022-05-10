// SPDX-License-Identifier: MIT
// solhint-disable var-name-mixedcase, func-name-mixedcase
pragma solidity >=0.6.12;

interface ICurveThreePool {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external;

    function get_dy_underlying(
        int128 i,
        int128 j,
        uint256 dx
    ) external view returns (uint256);

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view returns (uint256);

    function add_liquidity(uint256[3] memory amounts, uint256 _min_mint_amount) external;

    function remove_liquidity_one_coin(
        uint256 amount,
        int128 i,
        uint256 minAmount
    ) external;
}
