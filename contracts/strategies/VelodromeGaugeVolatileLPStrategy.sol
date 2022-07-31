// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "solmate/src/tokens/ERC20.sol";
import "solmate/src/utils/SafeTransferLib.sol";

import "../MinimalBaseStrategy.sol";
import "../interfaces/velodrome/IVelodromeRouter.sol";
import "../interfaces/velodrome/IVelodromeGauge.sol";
import "../libraries/Babylonian.sol";

interface IRewardSwapper {
    function swap(
        address token,
        uint256 amount,
        address recipient
    ) external returns (uint256 lpAmount);
}

interface IPair {
    function getAmountOut(uint256, address) external view returns (uint256);

    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external;

    function getReserves()
        external
        view
        returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32 blockTimestampLast
        );

    function token0() external pure returns (address);

    function token1() external pure returns (address);
}

interface IPairFactory {
    function volatileFee() external view returns (uint256);
}

contract VelodromeGaugeVolatileLPStrategy is MinimalBaseStrategy {
    using SafeTransferLib for ERC20;

    error InsufficientAmountOut();
    error InvalidFeePercent();
    error NotCustomSwapperExecutor();

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);
    event FeeParametersChanged(address feeCollector, uint256 feePercent);
    event RewardTokenEnabled(address token, bool enabled);
    event LogSetCustomSwapperExecutor(address indexed executor, bool allowed);

    bytes32 internal constant PAIR_CODE_HASH = 0xc1ac28b1c4ebe53c0cff67bab5878c4eb68759bb1e9f73977cd266b247d149f0;
    IVelodromeRouter internal constant ROUTER = IVelodromeRouter(0xa132DAB612dB5cB9fC9Ac426A0Cc215A3423F9c9);
    address public constant VELO = 0x3c8B650257cFb5f272f799F5e2b4e65093a11a05;
    address public constant FACTORY = 0x25CbdDb98b35ab1FF77413456B31EC81A6B6B746;
    IPairFactory public constant PAIR_FACTORY = IPairFactory(0x25CbdDb98b35ab1FF77413456B31EC81A6B6B746);

    IVelodromeGauge public immutable gauge;

    address public immutable rewardToken;
    address public immutable pairInputToken;
    bool public immutable usePairToken0;

    address public feeCollector;
    uint8 public feePercent;

    address[] public rewardTokens;

    /// @notice add another access level for custom swapper since this has more power
    /// than executors.
    mapping(address => bool) public customSwapperExecutors;

    modifier onlyCustomSwapperExecutors() {
        if (!customSwapperExecutors[msg.sender]) {
            revert NotCustomSwapperExecutor();
        }
        _;
    }

    /** @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _bentoBox BentoBox address.
        @param _strategyExecutor an EOA that will execute the safeHarvest function.
        @param _gauge The velodrome gauge farm
        @param _rewardToken The gauge reward token
        @param _usePairToken0 When true, the _rewardToken will be swapped to the pair's token0 for one-sided liquidity
                                providing, otherwise, the pair's token1.
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _strategyExecutor,
        IVelodromeGauge _gauge,
        address _rewardToken,
        bool _usePairToken0
    ) MinimalBaseStrategy(_strategyToken, _bentoBox, _strategyExecutor) {
        gauge = _gauge;
        rewardToken = _rewardToken;
        feeCollector = _msgSender();

        (address token0, address token1) = _getPairTokens(_strategyToken);
        ERC20(token0).safeApprove(address(ROUTER), type(uint256).max);
        ERC20(token1).safeApprove(address(ROUTER), type(uint256).max);
        ERC20(_strategyToken).safeApprove(address(_gauge), type(uint256).max);

        usePairToken0 = _usePairToken0;
        pairInputToken = _usePairToken0 ? token0 : token1;

        rewardTokens.push(_rewardToken);
    }

    function _skim(uint256 amount) internal override {
        gauge.deposit(amount, 0);
    }

    function _harvest(uint256) internal override returns (int256) {
        gauge.getReward(address(this), rewardTokens);
        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        gauge.withdraw(amount);
    }

    function _exit() internal override {
        gauge.withdrawAll();
    }

    function _getPairTokens(address _pairAddress) private pure returns (address token0, address token1) {
        IPair pair = IPair(_pairAddress);
        token0 = pair.token0();
        token1 = pair.token1();
    }

    function _swapRewards() private returns (uint256 amountOut) {
        IPair pair = IPair(ROUTER.pairFor(rewardToken, pairInputToken, false));
        address token0 = pair.token0();
        uint256 amountIn = ERC20(rewardToken).balanceOf(address(this));
        amountOut = pair.getAmountOut(amountIn, rewardToken);
        ERC20(rewardToken).safeTransfer(address(pair), amountIn);

        if (token0 == rewardToken) {
            pair.swap(0, amountOut, address(this), "");
        } else {
            pair.swap(amountOut, 0, address(this), "");
        }
    }

    /// @dev adapted from https://blog.alphaventuredao.io/onesideduniswap/
    /// turn off fees since they are not automatically added to the pair when swapping
    /// but moved out of the pool
    function _calculateSwapInAmount(uint256 reserveIn, uint256 amountIn) internal view returns (uint256) {
        uint256 fee = PAIR_FACTORY.volatileFee();
        amountIn += ((amountIn * fee) / 10000) / 2;

        return (Babylonian.sqrt(4000000 * (reserveIn * reserveIn) + (4000000 * amountIn * reserveIn)) - 2000 * reserveIn) / 2000;
    }

    /// @notice Swap some tokens in the contract for the underlying and deposits them to address(this)
    function swapToLP(uint256 amountOutMin) public onlyExecutor returns (uint256 amountOut) {
        uint256 tokenInAmount = _swapRewards();
        (uint256 reserve0, uint256 reserve1, ) = IPair(strategyToken).getReserves();
        (address token0, address token1) = _getPairTokens(strategyToken);

        // The pairInputToken amount to swap to get the equivalent pair second token amount
        uint256 swapAmountIn = _calculateSwapInAmount(usePairToken0 ? reserve0 : reserve1, tokenInAmount);
        IPair pair = IPair(strategyToken);

        if (usePairToken0) {
            ERC20(token0).safeTransfer(strategyToken, swapAmountIn);
            pair.swap(0, pair.getAmountOut(swapAmountIn, token0), address(this), "");
        } else {
            ERC20(token1).safeTransfer(strategyToken, swapAmountIn);
            pair.swap(pair.getAmountOut(swapAmountIn, token1), 0, address(this), "");
        }

        uint256 amountStrategyLpBefore = ERC20(strategyToken).balanceOf(address(this));

        // Minting liquidity with optimal token balances but is still leaving some
        // dust because of rounding. The dust will be used the next time the function
        // is called.
        ROUTER.addLiquidity(
            token0,
            token1,
            false,
            ERC20(token0).balanceOf(address(this)),
            ERC20(token1).balanceOf(address(this)),
            0,
            0,
            address(this),
            type(uint256).max
        );
        uint256 total = ERC20(strategyToken).balanceOf(address(this)) - amountStrategyLpBefore;

        if (total < amountOutMin) {
            revert InsufficientAmountOut();
        }

        uint256 feeAmount = (total * feePercent) / 100;

        if (feeAmount > 0) {
            amountOut = total - feeAmount;
            ERC20(strategyToken).safeTransfer(feeCollector, feeAmount);
        }

        emit LpMinted(total, amountOut, feeAmount);
    }

    /// @notice swap any token inside this contract using the given custom swapper.
    /// expected output is `strategyToken` tokens.
    /// Only custom swpper executors are allowed to call this function as an extra layer
    /// of security because it could be used to transfer funds away.
    function swapToLPUsingCustomSwapper(
        ERC20 token,
        uint256 amountOutMin,
        IRewardSwapper swapper
    ) public onlyCustomSwapperExecutors returns (uint256 amountOut) {
        uint256 amountStrategyLpBefore = ERC20(strategyToken).balanceOf(address(this));

        uint256 amount = token.balanceOf(address(this));
        token.transfer(address(swapper), amount);
        swapper.swap(address(token), amount, address(this));

        uint256 total = ERC20(strategyToken).balanceOf(address(this)) - amountStrategyLpBefore;
        if (total < amountOutMin) {
            revert InsufficientAmountOut();
        }

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

        feeCollector = _feeCollector;
        feePercent = _feePercent;

        emit FeeParametersChanged(_feeCollector, _feePercent);
    }

    function setRewardTokenEnabled(address token, bool enabled) external onlyOwner {
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            if (rewardTokens[i] == token) {
                rewardTokens[i] = rewardTokens[rewardTokens.length - 1];
                rewardTokens.pop();
                break;
            }
        }

        if (enabled) {
            rewardTokens.push(token);
        }

        emit RewardTokenEnabled(token, enabled);
    }

    function setCustomSwapperExecutor(address executor, bool value) external onlyOwner {
        customSwapperExecutors[executor] = value;
        emit LogSetCustomSwapperExecutor(executor, value);
    }
}
