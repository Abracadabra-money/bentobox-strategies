// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../libraries/Babylonian.sol";
import "../../interfaces/IStrategy.sol";
import "../../interfaces/ISushiSwap.sol";
import "../../interfaces/IMasterChef.sol";
import "../../interfaces/ISubDynamicStrategy.sol";
import "../../interfaces/IBentoBoxMinimal.sol";

/// @notice Dynamic strategy that can have different farming strategy
/// For example, farming on Trader Joe then unwrap the jLP to 
/// mint pLP and farm on Pengolin.
contract DynamicLPStrategy is IStrategy, Ownable  {
    using SafeERC20 for IERC20;

    address public immutable strategyToken;
    address public immutable bentoBox;

    address public feeCollector;
    uint8 public feePercent;

    uint256 public maxBentoBoxBalance; /// @dev Slippage protection when calling harvest
    mapping(address => bool) public strategyExecutors; /// @dev EOAs that can execute safeHarvest
    mapping(ISubDynamicStrategy => bool) public enabledSubStrategies;

    ISubDynamicStrategy public immutable defaultSubStrategy;
    ISubDynamicStrategy public currentSubStrategy;

    bool public exited; /// @dev After bentobox 'exits' the strategy harvest, skim and withdraw functions can no loner be called

    event LogSubStrategyEnabled(address indexed subStrategy, bool enabled);
    event LogSetStrategyExecutor(address indexed executor, bool allowed);

    /** @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _bentoBox BentoBox address.
        @param _strategyExecutor an EOA that will execute the safeHarvest function.
        @param _defaultSubStrategy the default sub strategy, must be handling _strategyToken token. It should not be
        converting the _strategyToken to any underlying so that the skim, withdraw and exit work seamlessly without
        converting the sub strategy to  _strategyToken.
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _strategyExecutor,
        ISubDynamicStrategy _defaultSubStrategy
    ) {
        defaultSubStrategy = _defaultSubStrategy;
        strategyToken = _strategyToken;
        bentoBox = _bentoBox;

        if (_strategyExecutor != address(0)) {
            strategyExecutors[_strategyExecutor] = true;
            emit LogSetStrategyExecutor(_strategyExecutor, true);
        }
    }

    modifier isActive() {
        require(!exited, "BentoBox Strategy: exited");
        _;
    }

    modifier onlyBentoBox() {
        require(msg.sender == bentoBox, "BentoBox Strategy: only BentoBox");
        _;
    }

    modifier onlyDefaultStrategy() {
        require(currentSubStrategy == defaultSubStrategy, "not default strategy");
        _;
    }

    modifier onlyExecutor() {
        require(strategyExecutors[msg.sender], "BentoBox Strategy: only Executors");
        _;
    }

    function setStrategyEnabled(ISubDynamicStrategy subStrategy, bool enabled) public onlyOwner {
        //require(subStrategy.tokenIn == strategyToken, "tokenIn is not strategyToken");
        require(address(subStrategy) != address(0), "zero address");
        require(subStrategy != defaultSubStrategy || enabled, "cannot disable default strategy");

        enabledSubStrategies[subStrategy] = enabled;
        emit LogSubStrategyEnabled(address(subStrategy), enabled);
    }

    function setCurrentStrategy(ISubDynamicStrategy subStrategy) public onlyOwner {
        require(enabledSubStrategies[subStrategy], "not enabled");
        require(currentSubStrategy != subStrategy, "already current");

        ISubDynamicStrategy previousSubStrategy = currentSubStrategy;
        currentSubStrategy = subStrategy;
    }

    // TODO: SUPPORT INPUT TRADER JOE jLP when strat is not the default one!
     /// @inheritdoc IStrategy
    function skim(uint256 amount) external onlyDefaultStrategy override {
        defaultSubStrategy.skim(amount);
    }

    // TODO: SUPPORT INPUT TRADER JOE jLP when strat is not the default one!
    /// @inheritdoc IStrategy
    function withdraw(uint256 amount) external override isActive onlyBentoBox onlyDefaultStrategy returns (uint256 actualAmount) {
        defaultSubStrategy.withdraw(amount);

        /// @dev Make sure we send and report the exact same amount of tokens by using balanceOf.
        actualAmount = IERC20(strategyToken).balanceOf(address(this));
        IERC20(strategyToken).safeTransfer(bentoBox, actualAmount);
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
        require(!rebalance || currentSubStrategy == defaultSubStrategy, "not default strategy");

        if (maxBalance > 0) {
            maxBentoBoxBalance = maxBalance;
        }

        IBentoBoxMinimal(bentoBox).harvest(strategyToken, rebalance, maxChangeAmount);
    }

    /// @inheritdoc IStrategy
    /// @dev Only BentoBox can call harvest on this strategy.
    /// @dev Ensures that (1) the caller was this contract (called through the safeHarvest function)
    /// and (2) that we are not being frontrun by a large BentoBox deposit when harvesting profits.
    /// @dev Beware that calling harvest can result in a subsequent skim or withdraw call if it's rebalancing.
    function harvest(uint256 balance, address sender) external override isActive onlyBentoBox returns (int256) {
        /** @dev Don't revert if conditions aren't met in order to allow
            BentoBox to continiue execution as it might need to do a rebalance. */
        if (sender == address(this) && IBentoBoxMinimal(bentoBox).totals(strategyToken).elastic <= maxBentoBoxBalance && balance > 0) {
            return int256(currentSubStrategy.harvest());
        }
 
        return int256(0);
    }

    /// @inheritdoc IStrategy
    /// @dev do not use isActive modifier here; allow bentobox to call strategy.exit() multiple times
    function exit(uint256 balance) external override onlyBentoBox onlyDefaultStrategy returns (int256 amountAdded) {
        defaultSubStrategy.exit();

        uint256 actualBalance = IERC20(strategyToken).balanceOf(address(this));
        /// @dev Calculate tokens added (or lost).
        amountAdded = int256(actualBalance) - int256(balance);
        /// @dev Transfer all tokens to bentoBox.
        IERC20(strategyToken).safeTransfer(bentoBox, actualBalance);
        /// @dev Flag as exited, allowing the owner to manually deal with any amounts available later.
        exited = true;
    }

    function setStrategyExecutor(address executor, bool value) external onlyOwner {
        strategyExecutors[executor] = value;
        emit LogSetStrategyExecutor(executor, value);
    }

    function setFeeParameters(address _feeCollector, uint8 _feePercent) external onlyOwner {
        feeCollector = _feeCollector;
        feePercent = _feePercent;
    }
}
