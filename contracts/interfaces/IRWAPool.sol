//SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

interface IRWAPool {
    // Errors
    error OverBurn();
    error OnlyReserve();
    error OnlyAdmin();
    error OnlyMinter();
    error OnlyBurner();
    error OnlyReceipient();
    error OnlyRebaseAdmin();
    error OnlyFactory();
    error OverMaxRedeemSize();
    error OverMaxSubscribeLimit();
    error RedeemTooSmall();
    error SubscribeTooSmall();
    error ExpiredPermit();
    error InvalidSignature();
    error AddressBlocked();
    error FeaturePaused();
    error ExceedRebaseLimit();
    error RebaseIntervalTooShort();
    error InvalidRebaseLimit();

    // Events
    event Rebase(uint256 prevNetValue, uint256 newNetValue);
    event MinterUpdated(address indexed newMinter);
    event BurnerUpdated(address indexed newBurner);
    event RebaseAdminUpdated(address indexed newBurner);
    event ReserveUpdated(address indexed newReserve);
    event ProtocolUpdated(address indexed newProtocol);
    event FeeReceipientUpdated(address indexed newFeeReceipient);
    event OperatorUpdated(address indexed newOperator);
    event Redeem(address indexed account, uint256 shares);
    event SubscribeT0(address indexed account, uint256 amount);
    event SubscribeT1(address indexed account, uint256 amount);
    event MaxRedeemQueueSizeUpdated(uint256 newMaxRedeemSize);
    event CollectFee(address indexed account, uint256 amount);
    event FundingFromReserve(address indexed account, uint256 amount);
    event WithdrawToReserve(address indexed account, uint256 amount);
    event ProtocolFeeUpdated(uint256 newSubscribeFee, uint256 newRedeemFee);
    event MinimumRedeemUpdated(uint256 minRedeemAmount);
    event MinimumRedeemIntervalUpdated(uint256 minRedeemInterval);
    event MinimumSubscribeUpdated(uint256 minSubscribeAmount);
    event MaximumStakingLimitUpdated(uint256 maxStakingLimit);
    event SubscriptionPaused(address indexed account);
    event RedemptionPaused(address indexed account);
    event SubscriptionUnpaused(address indexed account);
    event RedemptionUnpaused(address indexed account);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event AdminTransferStarted(address indexed previousAdmin, address indexed newAdmin);
    event BlockListUpdated(address oldList, address newList);
    event RebaseIntervalUpdated(uint256 prevRebaseInterval, uint256 newRebaseInterval);
    event RebaseRateLimitUpdated(uint256 newProfitRateLimit, uint256 newLossRateLimit);

    // Functions

    function subscribe(address receiver, uint256 amount) external;

    function redeem(uint256 amount) external;

    function mintShares(address[] calldata accounts) external;

    function burnShares(address[] calldata accounts) external;

    function rebase(uint256 netValue) external;

    function withdrawToReserve(uint256 amount) external;

    function fundingFromReserve(uint256 amount) external;

    function maximumTotalStakingLimit() external view returns (uint256);

    function minimumSubscribeAmount() external view returns (uint256);

    function minimumRedeemAmount() external view returns (uint256);

    function minimumRedeemInterval() external view returns (uint256);

    function subscribeFee() external view returns (uint256);

    function redeemFee() external view returns (uint256);

    function protocolFee() external view returns (uint256);

    function bufferedFund() external view returns (uint256);

    function reservedFund() external view returns (uint256);

    function unconfirmedFund(address account) external view returns (uint256);

    function userPendingRedeemShares(address account) external view returns (uint256);

    function fundOf(address account) external view returns (uint256);

    function availableShares(address account) external view returns (uint256);

    function totalUnconfirmedFund() external view returns (uint256);

    function totalPendingRedeemShares() external view returns (uint256);

    function totalLockedFund() external returns (uint256);
}
