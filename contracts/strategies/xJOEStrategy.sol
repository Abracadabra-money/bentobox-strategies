// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../BaseStrategy.sol";
import "../interfaces/ISushiSwap.sol";
import "../interfaces/IMasterChef.sol";
import "../libraries/Babylonian.sol";

interface IxJOE is IERC20 {
    function enter(uint256 _amount) external;
    function leave(uint256 _share) external;
} 

contract XJOEStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);

    uint256 private constant DEADLINE = 0xf000000000000000000000000000000000000000000000000000000000000000; // ~ placeholder for swap deadline
    uint256 private constant FEE = 10; // 10% fees on minted LP

    ISushiSwap private immutable router;
    IMasterChef private immutable masterchef;
    uint256 private constant pid = 24;

    IERC20 private constant JOE = IERC20(0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd);

    address public feeCollector;

    /** @param _strategyToken Address of the underlying LP token the strategy invests.
        @param _bentoBox BentoBox address.
        @param _factory SushiSwap factory.
        @param _bridgeToken An intermediary token for swapping any rewards into it before swapping it to _inputPairToken
        @param _strategyExecutor an EOA that will execute the safeHarvest function.
    */
    constructor(
        address _strategyToken,
        address _bentoBox,
        address _factory,
        address _bridgeToken,
        address _strategyExecutor,
        IMasterChef _masterchef,
        ISushiSwap _router,
        bytes32 _pairCodeHash
    ) BaseStrategy(_strategyToken, _bentoBox, _factory, _bridgeToken, _strategyExecutor, _pairCodeHash) {

        masterchef = _masterchef;
        router = _router;
        feeCollector = _msgSender();

        IERC20(_strategyToken).safeApprove(address(_masterchef), type(uint256).max);
        IERC20(JOE).safeApprove(address(_strategyToken), type(uint256).max);
    }

    function _skim(uint256 amount) internal override {
        masterchef.deposit(pid, amount);
    }

    function _harvest(uint256) internal override returns (int256) {
        masterchef.withdraw(pid, 0);

        IxJOE(strategyToken).enter(JOE.balanceOf(address(this)));

        uint256 total = IERC20(strategyToken).balanceOf(address(this));
        uint256 feeAmount = (total * FEE) / 100;

        IERC20(strategyToken).safeTransfer(feeCollector, feeAmount);

        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        masterchef.withdraw(pid, amount);
    }

    function _exit() internal override {
        masterchef.emergencyWithdraw(pid);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
    }
}
