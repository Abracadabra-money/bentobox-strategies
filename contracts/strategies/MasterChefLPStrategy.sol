// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.7;

import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import "../BaseStrategy.sol";
import "../interfaces/ISushiSwap.sol";
import "../interfaces/IMasterChef.sol";
import "../libraries/Babylonian.sol";

contract MasterChefLPStrategy is BaseStrategy {
    using SafeTransferLib for ERC20;

    error InvalidFeePercent();
    error InsupportedToken(address token);

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);
    event RewardTokenUpdated(address token, bool enabled);
    event FeeChanged(uint256 previousFee, uint256 newFee, address previousFeeCollector, address newFeeCollector);

    ISushiSwap public immutable router;
    IMasterChef public immutable masterchef;
    uint256 public immutable pid;
    address public immutable token0;
    address public immutable token1;

    struct RewardTokenInfo {
        bool enabled;
        // When true, the _rewardToken will be swapped to the pair's token0 for one-sided liquidity providing, otherwise, the pair's token1.
        bool usePairToken0;
        // An intermediary token for swapping any rewards into it before swapping it to _inputPairToken
        address bridgeToken;
    }

    mapping(address => RewardTokenInfo) public rewardTokensInfo;

    address public feeCollector;
    uint8 public feePercent;

    /** @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _bentoBox BentoBox address.
        @param _factory SushiSwap factory.
        @param _strategyExecutor an EOA that will execute the safeHarvest function.

        @param _pairCodeHash This hash is used to calculate the address of a uniswap-like pool
                                by providing only the addresses of the two ERC20 tokens.
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _factory,
        address _strategyExecutor,
        IMasterChef _masterchef,
        uint256 _pid,
        ISushiSwap _router,
        bytes32 _pairCodeHash
    ) BaseStrategy(_strategyToken, _bentoBox, _factory, address(0), _strategyExecutor, _pairCodeHash) {
        masterchef = _masterchef;
        pid = _pid;
        router = _router;
        feeCollector = _msgSender();
        address _token0 = ISushiSwap(_strategyToken).token0();
        address _token1 = ISushiSwap(_strategyToken).token1();

        ERC20(_token0).safeApprove(address(_router), type(uint256).max);
        ERC20(_token1).safeApprove(address(_router), type(uint256).max);
        ERC20(_strategyToken).safeApprove(address(_masterchef), type(uint256).max);

        token0 = _token0;
        token1 = _token1;
    }

    /// @param token The reward token to add
    /// @param bridgeToken The token to swap the reward token into because swapping to the lp input token for minting
    /// @param usePairToken0 When true, the _rewardToken will be swapped to the pair's token0 for one-sided liquidity
    /// providing, otherwise, the pair's token1.
    function setRewardTokenInfo(
        address token,
        address bridgeToken,
        bool usePairToken0,
        bool enabled
    ) external onlyOwner {
        rewardTokensInfo[token] = RewardTokenInfo(enabled, usePairToken0, bridgeToken);
        emit RewardTokenUpdated(token, enabled);
    }

    function _skim(uint256 amount) internal override {
        masterchef.deposit(pid, amount);
    }

    function _harvest(uint256) internal override returns (int256) {
        masterchef.withdraw(pid, 0);
        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        masterchef.withdraw(pid, amount);
    }

    function _exit() internal override {
        masterchef.emergencyWithdraw(pid);
    }

    function _swapTokens(address tokenIn, address tokenOut) private returns (uint256 amountOut) {
        bool useBridge = bridgeToken != address(0);
        address[] memory path = new address[](useBridge ? 3 : 2);

        path[0] = tokenIn;

        if (useBridge) {
            path[1] = bridgeToken;
        }

        path[path.length - 1] = tokenOut;

        uint256 amountIn = IERC20(path[0]).balanceOf(address(this));
        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path, pairCodeHash);
        amountOut = amounts[amounts.length - 1];

        ERC20(path[0]).safeTransfer(UniswapV2Library.pairFor(factory, path[0], path[1], pairCodeHash), amounts[0]);
        _swap(amounts, path, address(this));
    }

    function _calculateSwapInAmount(uint256 reserveIn, uint256 userIn) internal pure returns (uint256) {
        return (Babylonian.sqrt(reserveIn * ((userIn * 3988000) + (reserveIn * 3988009))) - (reserveIn * 1997)) / 1994;
    }

    /// @notice Swap some tokens in the contract for the underlying and deposits them to address(this)
    function swapToLP(uint256 amountOutMin, address rewardToken) public onlyExecutor returns (uint256 amountOut) {
        RewardTokenInfo memory info = rewardTokensInfo[rewardToken];
        if (!info.enabled) {
            revert InsupportedToken(rewardToken);
        }

        address pairInputToken = info.usePairToken0 ? token0 : token1;

        uint256 tokenInAmount = _swapTokens(rewardToken, pairInputToken);
        (uint256 reserve0, uint256 reserve1, ) = ISushiSwap(strategyToken).getReserves();
 
        // The pairInputToken amount to swap to get the equivalent pair second token amount
        uint256 swapAmountIn = _calculateSwapInAmount(info.usePairToken0 ? reserve0 : reserve1, tokenInAmount);

        address[] memory path = new address[](2);
        if (info.usePairToken0) {
            path[0] = token0;
            path[1] = token1;
        } else {
            path[0] = token1;
            path[1] = token0;
        }

        uint256[] memory amounts = UniswapV2Library.getAmountsOut(factory, swapAmountIn, path, pairCodeHash);
        ERC20(path[0]).safeTransfer(strategyToken, amounts[0]);
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
        require(total >= amountOutMin, "InsufficientAmountOut");

        uint256 feeAmount = (total * feePercent) / 100;
        if (feeAmount > 0) {
            amountOut = total - feeAmount;
            ERC20(strategyToken).safeTransfer(feeCollector, feeAmount);
        }

        emit LpMinted(total, amountOut, feeAmount);
    }

    function setFeeParameters(address _feeCollector, uint8 _feePercent) external onlyOwner {
        if (feePercent > 100) {
            revert InvalidFeePercent();
        }

        uint256 previousFee = feePercent;
        address previousFeeCollector = feeCollector;

        feeCollector = _feeCollector;
        feePercent = _feePercent;

        emit FeeChanged(previousFee, _feePercent, previousFeeCollector, _feeCollector);
    }
}
