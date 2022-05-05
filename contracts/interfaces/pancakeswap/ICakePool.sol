// SPDX-License-Identifier: MIT
// solhint-disable func-name-mixedcase
pragma solidity >=0.8.7;

interface ICakePool {
    function BOOST_WEIGHT() external view returns (uint256);

    function BOOST_WEIGHT_LIMIT() external view returns (uint256);

    function DURATION_FACTOR() external view returns (uint256);

    function DURATION_FACTOR_OVERDUE() external view returns (uint256);

    function MAX_LOCK_DURATION() external view returns (uint256);

    function MAX_LOCK_DURATION_LIMIT() external view returns (uint256);

    function MAX_OVERDUE_FEE() external view returns (uint256);

    function MAX_PERFORMANCE_FEE() external view returns (uint256);

    function MAX_WITHDRAW_FEE() external view returns (uint256);

    function MAX_WITHDRAW_FEE_PERIOD() external view returns (uint256);

    function MIN_DEPOSIT_AMOUNT() external view returns (uint256);

    function MIN_LOCK_DURATION() external view returns (uint256);

    function MIN_WITHDRAW_AMOUNT() external view returns (uint256);

    function PRECISION_FACTOR() external view returns (uint256);

    function PRECISION_FACTOR_SHARE() external view returns (uint256);

    function UNLOCK_FREE_DURATION() external view returns (uint256);

    function VCake() external view returns (address);

    function admin() external view returns (address);

    function available() external view returns (uint256);

    function balanceOf() external view returns (uint256);

    function boostContract() external view returns (address);

    function cakePoolPID() external view returns (uint256);

    function calculateOverdueFee(address _user) external view returns (uint256);

    function calculatePerformanceFee(address _user) external view returns (uint256);

    function calculateTotalPendingCakeRewards() external view returns (uint256);

    function calculateWithdrawFee(address _user, uint256 _shares) external view returns (uint256);

    function deposit(uint256 _amount, uint256 _lockDuration) external;

    function freeOverdueFeeUsers(address) external view returns (bool);

    function freePerformanceFeeUsers(address) external view returns (bool);

    function freeWithdrawFeeUsers(address) external view returns (bool);

    function getPricePerFullShare() external view returns (uint256);

    function inCaseTokensGetStuck(address _token) external;

    function init(address dummyToken) external;

    function masterchefV2() external view returns (address);

    function operator() external view returns (address);

    function overdueFee() external view returns (uint256);

    function owner() external view returns (address);

    function pause() external;

    function paused() external view returns (bool);

    function performanceFee() external view returns (uint256);

    function performanceFeeContract() external view returns (uint256);

    function renounceOwnership() external;

    function setAdmin(address _admin) external;

    function setBoostContract(address _boostContract) external;

    function setBoostWeight(uint256 _boostWeight) external;

    function setDurationFactor(uint256 _durationFactor) external;

    function setDurationFactorOverdue(uint256 _durationFactorOverdue) external;

    function setFreePerformanceFeeUser(address _user, bool _free) external;

    function setMaxLockDuration(uint256 _maxLockDuration) external;

    function setOperator(address _operator) external;

    function setOverdueFee(uint256 _overdueFee) external;

    function setOverdueFeeUser(address _user, bool _free) external;

    function setPerformanceFee(uint256 _performanceFee) external;

    function setPerformanceFeeContract(uint256 _performanceFeeContract) external;

    function setTreasury(address _treasury) external;

    function setUnlockFreeDuration(uint256 _unlockFreeDuration) external;

    function setVCakeContract(address _VCake) external;

    function setWithdrawFee(uint256 _withdrawFee) external;

    function setWithdrawFeeContract(uint256 _withdrawFeeContract) external;

    function setWithdrawFeePeriod(uint256 _withdrawFeePeriod) external;

    function setWithdrawFeeUser(address _user, bool _free) external;

    function token() external view returns (address);

    function totalBoostDebt() external view returns (uint256);

    function totalLockedAmount() external view returns (uint256);

    function totalShares() external view returns (uint256);

    function transferOwnership(address newOwner) external;

    function treasury() external view returns (address);

    function unlock(address _user) external;

    function unpause() external;

    function userInfo(address)
        external
        view
        returns (
            uint256 shares,
            uint256 lastDepositedTime,
            uint256 cakeAtLastUserAction,
            uint256 lastUserActionTime,
            uint256 lockStartTime,
            uint256 lockEndTime,
            uint256 userBoostedShare,
            bool locked,
            uint256 lockedAmount
        );

    function withdraw(uint256 _shares) external;

    function withdrawAll() external;

    function withdrawByAmount(uint256 _amount) external;

    function withdrawFee() external view returns (uint256);
                                    
    function withdrawFeeContract() external view returns (uint256);

    function withdrawFeePeriod() external view returns (uint256);
}
