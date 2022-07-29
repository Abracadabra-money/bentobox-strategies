// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.7;

import "solmate/src/tokens/ERC20.sol";
import "solmate/src/utils/SafeTransferLib.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../../BaseStrategy.sol";
import "../../interfaces/IBentoBoxMinimal.sol";
import "../../interfaces/stargate/ILPStaking.sol";
import "../../interfaces/stargate/IStargateToken.sol";
import "../../interfaces/stargate/IStargatePool.sol";
import "../../interfaces/stargate/IStargateRouter.sol";

abstract contract BaseStargateLPStrategy is BaseStrategy {
    using SafeTransferLib for ERC20;

    event LpMinted(uint256 total, uint256 strategyAmount, uint256 feeAmount);
    event FeeParametersChanged(address feeCollector, uint256 feeAmount);

    ILPStaking public immutable staking;
    IStargateToken public immutable stargateToken;
    IStargateRouter public immutable router;
    ERC20 public immutable underlyingToken;

    uint256 public immutable poolId;
    uint256 public immutable pid;

    address public feeCollector;
    uint8 public feePercent;

    constructor(
        address _strategyToken,
        address _bentoBox,
        IStargateRouter _router,
        uint256 _poolId,
        ILPStaking _staking,
        uint256 _pid
    ) BaseStrategy(_strategyToken, _bentoBox, address(0), address(0), address(0), "") {
        router = _router;
        poolId = _poolId;
        staking = _staking;
        pid = _pid;

        ERC20 _underlyingToken = ERC20(IStargatePool(_strategyToken).token());
        stargateToken = IStargateToken(_staking.stargate());
        feePercent = 10;
        feeCollector = _msgSender();

        _underlyingToken.safeApprove(address(_router), type(uint256).max);
        underlyingToken = _underlyingToken;

        ERC20(_strategyToken).safeApprove(address(_staking), type(uint256).max);
    }

    function _skim(uint256 amount) internal override {
        staking.deposit(pid, amount);
    }

    function _harvest(uint256) internal override returns (int256) {
        staking.withdraw(pid, 0);
        return int256(0);
    }

    function _withdraw(uint256 amount) internal override {
        staking.withdraw(pid, amount);
    }

    function _exit() internal override {
        staking.emergencyWithdraw(pid);
    }

    function swapToLP(uint256 amountOutMin) public onlyExecutor returns (uint256 amountOut) {
        uint256 stgBalance = stargateToken.balanceOf(address(this));

        // Current Stargate LP Amount
        uint256 amountStrategyLpBefore = ERC20(strategyToken).balanceOf(address(this));

        // STG -> Pool underlying Token (USDT, USDC...)
        _swapToUnderlying(stgBalance);

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

    function _swapToUnderlying(uint256 stgBalance) internal virtual;
}
