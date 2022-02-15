// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../BaseStrategy.sol";
import "../../interfaces/ISushiSwap.sol";
import "../../interfaces/IMasterChef.sol";
import "../../interfaces/ISubDynamicStrategy.sol";
import "../../libraries/Babylonian.sol";

/// @notice DynamicLPStrategy sub-strategy.
/// @dev For gas saving, the strategy directly transfers to bentobox instead
/// of transfering to DynamicLPStrategy.
contract DynamicSubLPStrategy is ISubDynamicStrategy {
    using SafeERC20 for IERC20;

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);

    address public immutable bentoBox;
    uint256 public immutable pid;
    address public immutable strategyToken;
    address public immutable factory;
    ISushiSwap public immutable router;
    IMasterChef public immutable masterchef;
    bytes32 public immutable pairCodeHash;
    address public immutable rewardToken;
    address public immutable pairInputToken;
    bool public immutable usePairToken0;
    address public immutable dynamicStrategy;

    event LogSetStrategyExecutor(address indexed executor, bool allowed);

    /** 
        @param _bentoBox BentoBox address.
        @param _dynamicStrategy The dynamic strategy this sub strategy belongs to
        @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _factory SushiSwap factory.
        @param _usePairToken0 When true, the _rewardToken will be swapped to the pair's token0 for one-sided liquidity
                                providing, otherwise, the pair's token1.
        @param _pairCodeHash This hash is used to calculate the address of a uniswap-like pool
                                by providing only the addresses of the two ERC20 tokens.
    */
    constructor(
        address _bentoBox,
        address _dynamicStrategy,
        address _strategyToken,
        address _factory,
        IMasterChef _masterchef,
        uint256 _pid,
        ISushiSwap _router,
        address _rewardToken,
        bool _usePairToken0,
        bytes32 _pairCodeHash
    ) {
        bentoBox = _bentoBox;
        masterchef = _masterchef;
        pid = _pid;
        router = _router;
        strategyToken = _strategyToken;
        factory = _factory;
        rewardToken = _rewardToken;
        dynamicStrategy = _dynamicStrategy;
        pairCodeHash = _pairCodeHash;

        (address token0, address token1) = _getPairTokens(address(_strategyToken));
        IERC20(token0).safeApprove(address(_router), type(uint256).max);
        IERC20(token1).safeApprove(address(_router), type(uint256).max);
        IERC20(_strategyToken).safeApprove(address(_masterchef), type(uint256).max);

        usePairToken0 = _usePairToken0;
        pairInputToken = _usePairToken0 ? token0 : token1;
    }

    modifier onlyDynamicStrategy() {
        require(dynamicStrategy == msg.sender, "invalid sender");
        _;
    }

    function skim(uint256 amount) external override onlyDynamicStrategy {
        masterchef.deposit(pid, amount);
    }

    function harvest() external override onlyDynamicStrategy returns (uint256 amountAdded) {
        masterchef.withdraw(pid, 0);

        amountAdded = IERC20(strategyToken).balanceOf(address(this));

        if (amountAdded > 0) {
            IERC20(strategyToken).transfer(bentoBox, amountAdded);
        }
    }

    function withdraw(uint256 amount) external override onlyDynamicStrategy returns (uint256 actualAmount) {
        masterchef.withdraw(pid, amount);

        actualAmount = IERC20(strategyToken).balanceOf(address(this));
        IERC20(strategyToken).safeTransfer(dynamicStrategy, actualAmount);
    }

    function exit() external override onlyDynamicStrategy returns (uint256 amountAdded) {
        masterchef.emergencyWithdraw(pid);
        IERC20(strategyToken).transfer(dynamicStrategy, IERC20(strategyToken).balanceOf(address(this)));
    }

    /// @notice Swap some tokens in the contract for the underlying and deposits them to address(this)
    function swapToLP(
        uint256 amountOutMin,
        uint256 feePercent,
        address feeTo
    ) public onlyDynamicStrategy returns (uint256 amountOut) {
        uint256 tokenInAmount = _swapTokens(rewardToken, pairInputToken);
        (uint256 reserve0, uint256 reserve1, ) = ISushiSwap(strategyToken).getReserves();
        (address token0, address token1) = _getPairTokens(strategyToken);

        // The pairInputToken amount to swap to get the equivalent pair second token amount
        uint256 swapAmountIn = _calculateSwapInAmount(usePairToken0 ? reserve0 : reserve1, tokenInAmount);

        address[] memory path = new address[](2);
        if (usePairToken0) {
            path[0] = token0;
            path[1] = token1;
        } else {
            path[0] = token1;
            path[1] = token0;
        }

        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, swapAmountIn, path, pairCodeHash);
        IERC20(path[0]).safeTransfer(strategyToken, amounts[0]);
        _swap(amounts, path, address(this));

        uint256 amountStrategyLpBefore = IERC20(strategyToken).balanceOf(address(this));

        // Minting liquidity with optimal token balances but is still leaving some
        // dust because of rounding. The dust will be used the next time the function
        // is called.
        router.addLiquidity(
            token0,
            token1,
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this)),
            1,
            1,
            address(this),
            type(uint256).max
        );

        uint256 total = IERC20(strategyToken).balanceOf(address(this)) - amountStrategyLpBefore;
        require(total >= amountOutMin, "INSUFFICIENT_AMOUNT_OUT");

        uint256 feeAmount = (total * feePercent) / 100;
        amountOut = total - feeAmount;

        IERC20(strategyToken).safeTransfer(feeTo, feeAmount);
        emit LpMinted(total, amountOut, feeAmount);
    }

    function _getPairTokens(address _pairAddress) private pure returns (address token0, address token1) {
        ISushiSwap sushiPair = ISushiSwap(_pairAddress);
        token0 = sushiPair.token0();
        token1 = sushiPair.token1();
    }

    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to
    ) internal {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address token0 = input < output ? input : output;
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address to = i < path.length - 2 ? UniswapV2Library.pairFor(factory, output, path[i + 2], pairCodeHash) : _to;
            IUniswapV2Pair(UniswapV2Library.pairFor(factory, input, output, pairCodeHash)).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    function _swapTokens(address tokenIn, address tokenOut) private returns (uint256 amountOut) {
        address[] memory path = new address[](2);

        path[0] = tokenIn;

        path[path.length - 1] = tokenOut;

        uint256 amountIn = IERC20(path[0]).balanceOf(address(this));
        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path, pairCodeHash);
        amountOut = amounts[amounts.length - 1];

        IERC20(path[0]).safeTransfer(UniswapV2Library.pairFor(factory, path[0], path[1], pairCodeHash), amounts[0]);
        _swap(amounts, path, address(this));
    }

    function _calculateSwapInAmount(uint256 reserveIn, uint256 userIn) internal pure returns (uint256) {
        return (Babylonian.sqrt(reserveIn * ((userIn * 3988000) + (reserveIn * 3988009))) - (reserveIn * 1997)) / 1994;
    }
}
