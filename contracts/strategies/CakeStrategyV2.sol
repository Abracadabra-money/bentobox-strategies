// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../BaseStrategy.sol";
import "../interfaces/pancakeswap/ICakePool.sol";
import "../interfaces/ISushiSwap.sol";
import "../libraries/Babylonian.sol";

contract CakeStrategyV2 is BaseStrategy {
    using SafeERC20 for IERC20;

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);
    ICakePool private immutable cakePool;

    uint256 public depositAmount;
    uint256 public fee; // fees on rewards
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
        ICakePool _cakePool,
        bytes32 _pairCodeHash
    ) BaseStrategy(_strategyToken, _bentoBox, _factory, _bridgeToken, _strategyExecutor, _pairCodeHash) {
        cakePool = _cakePool;
        feeCollector = _msgSender();
        fee = 10;

        IERC20(_strategyToken).safeApprove(address(_cakePool), type(uint256).max);
    }

    function _skim(uint256 amount) internal override {
        cakePool.deposit(amount, 0);
        (depositAmount, , , , , , , , ) = cakePool.userInfo(address(this));
    }

    function _harvest(uint256) internal override returns (int256) {
        /// @dev CakePool auto compound reward and increase share price in CAKE.
        /// Withdraw the accumulated amount instead.
        uint256 withdrawFee = cakePool.calculateWithdrawFee(address(this), depositAmount);
        uint256 currentAmount = cakePool.getPricePerFullShare() * depositAmount;
        require(currentAmount - withdrawFee >= depositAmount, "not profitable");

        // only withdraw the rewards
        cakePool.withdrawByAmount(currentAmount - depositAmount);
        uint256 total = IERC20(strategyToken).balanceOf(address(this));
        uint256 feeAmount = (total * fee) / 100;

        IERC20(strategyToken).safeTransfer(feeCollector, feeAmount);

        (depositAmount, , , , , , , , ) = cakePool.userInfo(address(this));
        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        cakePool.withdraw(amount);
        (depositAmount, , , , , , , , ) = cakePool.userInfo(address(this));
    }

    function _exit() internal override {
        cakePool.withdrawAll();
        depositAmount = 0;
    }

    function setFeeCollector(address _feeCollector, uint256 _fee) external onlyOwner {
        require(_fee <= 100, "max fee is 100");
        feeCollector = _feeCollector;
        fee = _fee;
    }
}
