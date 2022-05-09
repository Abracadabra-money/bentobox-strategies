// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "@rari-capital/solmate/src/tokens/ERC20.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/IStrategy.sol";
import "../../interfaces/IBentoBoxMinimal.sol";
import "../../interfaces/stargate/ILPStaking.sol";
import "../../interfaces/stargate/IStargateToken.sol";
import "../../interfaces/stargate/IStargatePool.sol";
import "../../interfaces/stargate/IStargateRouter.sol";

abstract contract BaseStargateLPStrategy is IStrategy, Ownable {
    using SafeTransferLib for ERC20;

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);
    event FeeParametersChanged(address feeCollector, uint256 feeAmount);
    event LogSetStrategyExecutor(address indexed executor, bool allowed);

    address public immutable strategyToken;
    address public immutable bentoBox;

    ILPStaking public immutable staking;
    IStargateToken public immutable stargateToken;
    IStargateRouter public immutable router;
    ERC20 public immutable underlyingToken;

    uint256 public immutable poolId;
    uint256 public immutable pid;

    address public feeCollector;
    uint8 public feePercent;

    bool public exited; /// @dev After bentobox 'exits' the strategy harvest, skim and withdraw functions can no loner be called
    uint256 public maxBentoBoxBalance; /// @dev Slippage protection when calling harvest
    mapping(address => bool) public strategyExecutors; /// @dev EOAs that can execute safeHarvest

    modifier isActive() {
        require(!exited, "exited");
        _;
    }

    modifier onlyBentoBox() {
        require(msg.sender == bentoBox, "only BentoBox");
        _;
    }

    modifier onlyExecutor() {
        require(strategyExecutors[msg.sender], "only Executors");
        _;
    }

    /** @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _underlyingToken Stargate pool underlying token
        @param _bentoBox BentoBox address.      
        @param _strategyExecutor an EOA that will execute the safeHarvest function.
        @param _staking Stargate lp staking address
        @param _pid Stargate lp staking pid
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        ERC20 _underlyingToken,
        IStargateRouter _router,
        uint256 _poolId,
        ILPStaking _staking,
        uint256 _pid,
        address _strategyExecutor
    ) {
        strategyToken = _strategyToken;
        bentoBox = _bentoBox;
        underlyingToken = _underlyingToken;
        router = _router;
        poolId = _poolId;
        staking = _staking;
        pid = _pid;

        stargateToken = IStargateToken(IStargatePool(_strategyToken).token());
        feePercent = 10;
        feeCollector = _msgSender();

        if (_strategyExecutor != address(0)) {
            strategyExecutors[_strategyExecutor] = true;
            emit LogSetStrategyExecutor(_strategyExecutor, true);
        }

        ERC20(_strategyToken).safeApprove(address(_staking), type(uint256).max);
    }

    function _skim(uint256 amount) internal {
        staking.deposit(pid, amount);
    }

    function _harvest(uint256) internal returns (int256) {
        staking.withdraw(pid, 0);
        return int256(0);
    }

    function _withdraw(uint256 amount) internal {
        staking.withdraw(pid, amount);
    }

    function _exit() internal {
        staking.emergencyWithdraw(pid);
    }

    function setStrategyExecutor(address executor, bool value) external onlyOwner {
        strategyExecutors[executor] = value;
        emit LogSetStrategyExecutor(executor, value);
    }

    /// @inheritdoc IStrategy
    function skim(uint256 amount) external override {
        _skim(amount);
    }

    /// @notice Harvest profits while preventing a sandwich attack exploit.
    /// @param maxBalance The maximum balance of the underlying token that is allowed to be in BentoBox.
    /// @param rebalance Whether BentoBox should rebalance the strategy assets to acheive it's target allocation.
    /// @param maxChangeAmount When rebalancing - the maximum amount that will be deposited to or withdrawn from a strategy to BentoBox.
    /// @dev maxBalance can be set to 0 to keep the previous value.
    /// @dev maxChangeAmount can be set to 0 to allow for full rebalancing.
    function safeHarvest(
        uint256 maxBalance,
        bool rebalance,
        uint256 maxChangeAmount
    ) external onlyExecutor {
        if (maxBalance > 0) {
            maxBentoBoxBalance = maxBalance;
        }

        IBentoBoxMinimal(bentoBox).harvest(strategyToken, rebalance, maxChangeAmount);
    }

    /** @inheritdoc IStrategy
    @dev Only BentoBox can call harvest on this strategy.
    @dev Ensures that (1) the caller was this contract (called through the safeHarvest function)
        and (2) that we are not being frontrun by a large BentoBox deposit when harvesting profits. */
    function harvest(uint256 balance, address sender) external override isActive onlyBentoBox returns (int256) {
        /** @dev Don't revert if conditions aren't met in order to allow
            BentoBox to continiue execution as it might need to do a rebalance. */

        if (sender == address(this) && IBentoBoxMinimal(bentoBox).totals(strategyToken).elastic <= maxBentoBoxBalance && balance > 0) {
            int256 amount = _harvest(balance);

            /** @dev Since harvesting of rewards is accounted for seperately we might also have
            some underlying tokens in the contract that the _harvest call doesn't report. 
            E.g. reward tokens that have been sold into the underlying tokens which are now sitting in the contract.
            Meaning the amount returned by the internal _harvest function isn't necessary the final profit/loss amount */

            uint256 contractBalance = ERC20(strategyToken).balanceOf(address(this));

            if (amount >= 0) {
                // _harvest reported a profit

                if (contractBalance > 0) {
                    ERC20(strategyToken).safeTransfer(bentoBox, contractBalance);
                }

                return int256(contractBalance);
            } else if (contractBalance > 0) {
                // _harvest reported a loss but we have some tokens sitting in the contract

                int256 diff = amount + int256(contractBalance);

                if (diff > 0) {
                    // we still made some profit

                    /// @dev send the profit to BentoBox and reinvest the rest
                    ERC20(strategyToken).safeTransfer(bentoBox, uint256(diff));
                    _skim(uint256(-amount));
                } else {
                    // we made a loss but we have some tokens we can reinvest

                    _skim(contractBalance);
                }

                return diff;
            } else {
                // we made a loss

                return amount;
            }
        }

        return int256(0);
    }

    /// @inheritdoc IStrategy
    function withdraw(uint256 amount) external override isActive onlyBentoBox returns (uint256 actualAmount) {
        _withdraw(amount);
        /// @dev Make sure we send and report the exact same amount of tokens by using balanceOf.
        actualAmount = ERC20(strategyToken).balanceOf(address(this));
        ERC20(strategyToken).safeTransfer(bentoBox, actualAmount);
    }

    /// @inheritdoc IStrategy
    /// @dev do not use isActive modifier here; allow bentobox to call strategy.exit() multiple times
    function exit(uint256 balance) external override onlyBentoBox returns (int256 amountAdded) {
        _exit();
        /// @dev Check balance of token on the contract.
        uint256 actualBalance = ERC20(strategyToken).balanceOf(address(this));
        /// @dev Calculate tokens added (or lost).
        amountAdded = int256(actualBalance) - int256(balance);
        /// @dev Transfer all tokens to bentoBox.
        ERC20(strategyToken).safeTransfer(bentoBox, actualBalance);
        /// @dev Flag as exited, allowing the owner to manually deal with any amounts available later.
        exited = true;
    }

    /** @dev After exited, the owner can perform ANY call. This is to rescue any funds that didn't
        get released during exit or got earned afterwards due to vesting or airdrops, etc. */
    function afterExit(
        address to,
        uint256 value,
        bytes memory data
    ) public onlyOwner returns (bool success) {
        require(exited, "BentoBox Strategy: not exited");

        // solhint-disable-next-line avoid-low-level-calls
        (success, ) = to.call{value: value}(data);
    }

    function swapToLP(uint256 amountOutMin) public onlyExecutor returns (uint256 amountOut) {
        // Current Stargate LP Amount
        uint256 amountStrategyLpBefore = ERC20(strategyToken).balanceOf(address(this));

        // STG -> Pool underlying Token (USDT, USDC...)
        _swapToUnderlying();

        // Pool underlying Token in this contract
        uint256 underlyingTokenAmount = underlyingToken.balanceOf(address(this));

        // Underlying Token -> Stargate Pool LP
        router.addLiquidity(poolId, underlyingTokenAmount, address(this));

        uint256 total = ERC20(strategyToken).balanceOf(address(this)) - amountStrategyLpBefore;
        require(total >= amountOutMin, "INSUFFICIENT_AMOUNT_OUT");

        uint256 feeAmount = (total * feePercent) / 100;
        amountOut = total - feeAmount;
        ERC20(strategyToken).transfer(feeCollector, feeAmount);

        emit LpMinted(total, amountOut, feeAmount);
    }

    function setFeeParameters(address _feeCollector, uint8 _feePercent) external onlyOwner {
        require(feePercent <= 100, "invalid feePercent");
        feeCollector = _feeCollector;
        feePercent = _feePercent;

        emit FeeParametersChanged(_feeCollector, _feePercent);
    }

    function _swapToUnderlying() internal virtual;
}
