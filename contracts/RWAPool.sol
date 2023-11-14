//SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./StUSD.sol";
import "./utils/Errors.sol";
import "./utils/Queue.sol";

import "./interfaces/IBlockList.sol";
import "./interfaces/IRWAPool.sol";
import "./interfaces/IRWAFactory.sol";

/// @dev The main implementation contract for RWA
contract RWAPool is IRWAPool, StUSD, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;
    using Queue for Queue.RedeemQueue;

    /*//////////////////////////////////////////////////////////////
                         State variables
    //////////////////////////////////////////////////////////////*/

    /**
     * NOTE:  Never change the order of the state variables below, Only append after them
     */

    /// @notice Subscription feature status
    bool public subscriptionPaused;
    /// @notice Redemption feature status
    bool public redemptionPaused;

    IERC20 public stablecoin;

    address public factory;

    IBlockList public blocklist;

    /// @notice The admin account for protocol
    address public admin;
    address public pendingAdmin;
    /// @notice The admin which executes daily rebase.
    address public rebaseAdmin;

    /// @notice Proof of reserve account, generated from CEX, anyone can check its latest net value base on CEX Proof.
    address public reserve;

    /// @notice Protocol fee receiver account.
    address public feeReceipient;

    /// @notice Account which executes 'mintshares'
    address public minter;

    /// @notice Account which executes 'burnshares'
    address public burner;

    /// @notice The total amount of USD subscribed but not confirmed
    mapping(address => uint256) public override unconfirmedFund;

    /// @notice The user pending redemption queue
    mapping(address => Queue.RedeemQueue) public userRedeemQueue;

    /// @notice The user total pending redemption shares
    mapping(address => uint256) public override userPendingRedeemShares;

    /// @notice Total pending redemption shares
    uint256 public override totalPendingRedeemShares;

    /// @dev Maximum redemption queue length, should be small number for saving gas when iterate redeem queue
    uint256 public maxRedeemQueueSize;

    /// @notice  Total accrued protocol fee
    uint256 public override protocolFee;

    /// @notice Total unconfirmed fund in current pool
    uint256 public override totalUnconfirmedFund;

    /// @notice Current buffered amount of USD in this smart contract, not including unconfirmed funds
    uint256 public override bufferedFund;

    /// @notice The total amount of funds in the proof of reserve account, will be updated during daily rebase
    uint256 public override reservedFund;

    /// @notice When owner withdraws USD from the contract to the proof of reserve account, set the funds
    /// to 'transient' state to ensure pool total asset value unchanged, will reset it to 0 after 'rebase'
    uint256 public transientOutFund;

    /// @notice When owner transfer USD to the contract from the proof of reserve account, set the funds
    /// to 'transient' state to ensure pool total asset value unchanged, will reset it to 0 after 'rebase'
    uint256 public transientInFund;

    /// @notice Maximize profit rate for 'rebase' operation
    uint256 public profitRateLimit;

    /// @notice Maximize loss rate for 'rebase' operation
    uint256 public lossRateLimit;

    /// @notice last rebase operation timestamp
    uint256 public lastRebaseTime;

    /// @notice Minimum 'rebase' interval time
    uint256 public rebaseInterval;

    /// @notice  Subscription fee rate, base on 10000
    uint256 public override subscribeFee;

    /// @notice  Redeem fee rate, base on 10000
    uint256 public override redeemFee;

    /// @notice Maxmium subscribe underlying amount
    uint256 public override maximumTotalStakingLimit;

    /// @notice Minimum subscribe underlying amount
    uint256 public override minimumSubscribeAmount;

    /// @notice Minimum redeem share amount
    uint256 public override minimumRedeemAmount;
    /// @notice Minimum redemption waiting inerval
    uint256 public override minimumRedeemInterval;

    /// @notice  Total base point for protocol fee
    uint256 public constant TOTAL_BASIS_POINTS = 10_000;

    /// @dev Should be according to operator time
    uint256 public constant T0_AVAILABLE = 28800; // 8 hours

    /// @dev Total base point for rebase rate
    uint256 public constant REBASE_BASIS_POINTS = 10_000;

    /**
     * NOTE:
     * Append here if necessary,
     *  Don't assign initial value for new state variable unless it's 'constant' value
     */

    function initialize(
        string memory _name,
        string memory _symbol,
        address _stablecoin,
        address _admin,
        address _minter,
        address _burner,
        address _rebaseAdmin,
        address _reserve,
        address _receipient
    ) external initializer {
        if (
            address(_stablecoin) == address(0) ||
            _admin == address(0) ||
            _minter == address(0) ||
            _burner == address(0) ||
            _rebaseAdmin == address(0) ||
            _reserve == address(0) ||
            _receipient == address(0)
        ) revert Errors.ZeroAddress();

        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);

        factory = msg.sender;
        stablecoin = IERC20(_stablecoin);
        admin = _admin;
        minter = _minter;
        burner = _burner;
        rebaseAdmin = _rebaseAdmin;
        reserve = _reserve;
        feeReceipient = _receipient;
    }

    /*//////////////////////////////////////////////////////////////
                        Feature Functions
    //////////////////////////////////////////////////////////////*/

    /// @notice Subscribe to stUSDT share, subscribing after 8 AM GMT will be effective next day.
    /// @param _account receiver Account
    /// @param _amount stablecoin amount
    function subscribe(
        address _account,
        uint256 _amount
    ) external override nonReentrant ifNotPaused(subscriptionPaused) notBlocked(_account) {
        if (_account == address(0)) revert Errors.ZeroAddress();
        if (_amount < minimumSubscribeAmount) revert SubscribeTooSmall();
        // accumulate '_amount' to early check for saving gas
        if (_getTotalUnderlying() + _amount > maximumTotalStakingLimit) revert OverMaxSubscribeLimit();

        stablecoin.safeTransferFrom(address(msg.sender), address(this), _amount);

        uint256 fee = (subscribeFee * _amount) / TOTAL_BASIS_POINTS;
        uint256 subAfterFee = _amount - fee;
        protocolFee += fee;

        if (_isTDay()) {
            // mint share immediately
            uint256 _totalSupply = _getTotalUnderlying();
            if (_totalSupply == 0) {
                // mint share 1:1 if pool is empty
                _mintShares(_account, subAfterFee);
            } else {
                // mint share according to current pool ratio
                uint256 shares2mint = (subAfterFee * totalShares) / _totalSupply;
                _mintShares(_account, shares2mint);
            }
            bufferedFund += subAfterFee;

            emit SubscribeT0(_account, subAfterFee);
        } else {
            // accumulate unconfirmed fund
            unconfirmedFund[_account] += subAfterFee;
            totalUnconfirmedFund += subAfterFee;

            emit SubscribeT1(_account, subAfterFee);
        }
    }

    /// @notice Apply for redemption at least 7 days in advance, and it will take effect on the 1st of the next month
    /// @dev Can't use 'balance' as parameter, because the 'rebase' mechanism, the balance may change every day.
    /// @param _shares shares amount
    function redeem(
        uint256 _shares
    ) external override nonReentrant notBlocked(msg.sender) ifNotPaused(redemptionPaused) {
        address account = msg.sender;
        if (userRedeemQueue[account].length() == maxRedeemQueueSize) revert OverMaxRedeemSize();

        uint256 _availableShares = availableShares(account);
        // if availableShares less than minimumRedeemAmount, redeem all shares
        _shares = _availableShares > minimumRedeemAmount ? _shares : _availableShares;

        if (_shares < minimumRedeemAmount && _availableShares > minimumRedeemAmount) revert RedeemTooSmall();
        if (_shares > _availableShares) revert ExceedBalance();

        // add redemption request to queue
        Queue.Redeem memory redemption = Queue.Redeem({ amount: _shares, timestamp: block.timestamp });
        userRedeemQueue[account].pushBack(redemption);

        userPendingRedeemShares[account] += _shares;
        totalPendingRedeemShares += _shares;

        emit Redeem(account, _shares);
    }

    /// @notice Contract operator mint shares for pending subscripitions.
    /// @param  _accounts Accounts waiting for mint shares
    /// @notice If an account has been blocked before 'mintShares', but it has been successfully subscribed, then it should not be included on the _accounts list.
    function mintShares(
        address[] calldata _accounts
    ) external override onlyMinter nonReentrant ifNotPaused(subscriptionPaused) {
        //                       _amounts * prevTotalShares
        // shares2mint = ---------------------------------------------
        //                  (previousUSDAmount * TOTAL_BASIS_POINTS)

        // saving gas
        uint256 _totalSupply = _getTotalUnderlying();
        uint256 _prevTotalUnconfirmedFund = totalUnconfirmedFund;

        address account;
        uint256 amount;
        uint256 shares2mint;
        uint256 curUnconfirmedFund = _prevTotalUnconfirmedFund;
        for (uint256 i = 0; i < _accounts.length; ) {
            // saving gas
            account = _accounts[i];
            // Double check to prevent user which was added to the blocklist before 'mintshares' but subscription was success.
            if (address(blocklist) != address(0) && blocklist.isBlocked(account)) revert AddressBlocked();

            amount = unconfirmedFund[account];

            if (_totalSupply == 0) {
                shares2mint = amount;
            } else {
                shares2mint = (amount * totalShares) / _totalSupply;
            }

            _mintShares(account, shares2mint);
            // added total supply for next loop
            _totalSupply += amount;
            // user unconfirmed amount reset to 0
            unconfirmedFund[account] = 0;
            // deduct total unconfirmed amount
            curUnconfirmedFund -= amount;

            emit MintShares(account, shares2mint, amount);

            unchecked {
                ++i;
            }
        }

        // convert unconfirmed fund to buffered fund
        bufferedFund += (_prevTotalUnconfirmedFund - curUnconfirmedFund);

        // update total unconfirmed fund amount
        totalUnconfirmedFund = curUnconfirmedFund;
    }

    /// @notice On 1st of each month, contract operator burn shares of investors who applied for redemption 7 days ago
    /// @dev Need to use 'subgraph' like services to track all the user redemption requests, to determine whether to
    ///  execute the user's redemption request
    /// @param  _accounts Pending redemption accounts
    /// @notice If an account has been blocked before 'burnShares', but it has been successfully Redeemed, then it should not be included on the _accounts list.
    function burnShares(
        address[] calldata _accounts
    ) external override onlyBurner nonReentrant ifNotPaused(redemptionPaused) {
        // saving gas
        address account;
        uint256 shareAmounts;
        uint256 _bufferedFund = bufferedFund;
        uint256 _totalShares = totalShares;
        uint256 _totalUnderlying = _getTotalUnderlying();

        for (uint256 i = 0; i < _accounts.length; ) {
            shareAmounts = 0;
            account = _accounts[i];
            // Double check to prevent user which was added to the blocklist before 'burnShares' but redemption was success.
            if (address(blocklist) != address(0) && blocklist.isBlocked(account)) revert AddressBlocked();

            Queue.RedeemQueue storage queue = userRedeemQueue[account];

            // Queue length <= maxRedeemQueueSize
            uint256 len = queue.length();
            for (uint256 index = 0; index < len; ) {
                // Access front element
                (uint256 _shares, uint256 timestamp) = queue.front();
                // Front element timestamp must be most smallest (FIFO)
                if ((block.timestamp - timestamp) < minimumRedeemInterval) {
                    unchecked {
                        ++index;
                    }
                    continue;
                }

                shareAmounts += _shares;
                // Remove front element
                queue.popFront();

                unchecked {
                    ++index;
                }
            }

            if (shareAmounts == 0) {
                unchecked {
                    ++i;
                }
                continue;
            }

            uint256 redeemAmount = (shareAmounts * _totalUnderlying) / _totalShares;

            uint256 redeemAfterFee = (redeemAmount * (TOTAL_BASIS_POINTS - redeemFee)) / TOTAL_BASIS_POINTS;

            protocolFee += (redeemAmount - redeemAfterFee);

            _burnShares(account, shareAmounts);
            // deduct buffered fund
            _bufferedFund -= redeemAmount;
            // deduct pending shares
            userPendingRedeemShares[account] -= shareAmounts;
            // deduct shares and total pooled USD for next loop calculation
            _totalUnderlying -= redeemAmount;
            _totalShares -= shareAmounts;

            stablecoin.safeTransfer(account, redeemAfterFee);

            unchecked {
                ++i;
            }
        }

        bufferedFund = _bufferedFund;
    }

    /// @notice Rebase admin updates the 'reserve' account's latest net value, causing changes in the
    /// current pool's USD amount, this will realize dynamic changes in the balances of all users
    /// @param _netValue Lastest net value of proof of reserve account
    function rebase(uint256 _netValue) external override onlyRebaseAdmin nonReentrant {
        if (block.timestamp - lastRebaseTime < rebaseInterval) revert RebaseIntervalTooShort();

        // before rebase is completed, the transient fund has not been reset to 0
        uint256 _prevReservedFund = reservedFund + transientOutFund - transientInFund;

        if (
            _prevReservedFund > 0 &&
            ((_netValue > _prevReservedFund &&
                _netValue - _prevReservedFund >= (_prevReservedFund * profitRateLimit) / REBASE_BASIS_POINTS) ||
                (_netValue < _prevReservedFund &&
                    _prevReservedFund - _netValue >= (_prevReservedFund * lossRateLimit) / REBASE_BASIS_POINTS))
        ) revert ExceedRebaseLimit();

        // update net value to 'reservedFund' storage
        reservedFund = _netValue;
        // reset fund of transient state to 0
        transientInFund = 0;
        transientOutFund = 0;

        lastRebaseTime = block.timestamp;

        emit Rebase(_prevReservedFund, _netValue);
    }

    /// @notice Transfer the  in the contract to the proof of reserve account
    /// @param  _amount USD amount
    function withdrawToReserve(uint256 _amount) external override onlyReserve nonReentrant {
        // can only transfer bufferedFund
        bufferedFund -= _amount;
        // temporary convert withdraw amount to transient state, the total supply of USD will not change
        transientOutFund += _amount;

        stablecoin.safeTransfer(reserve, _amount);

        emit WithdrawToReserve(reserve, _amount);
    }

    /// @notice Transfer USD from the proof of reserve account to the contract
    /// @param  _amount USD amount
    function fundingFromReserve(uint256 _amount) external override onlyReserve nonReentrant {
        bufferedFund += _amount;
        // temporary credit the funding amount to transient state, the total supply of USD will not change
        // can't deduct '_amount' from the 'reserveFund' in case '_amount' value bigger than 'reserveFund'
        transientInFund += _amount;
        stablecoin.safeTransferFrom(msg.sender, address(this), _amount);

        emit FundingFromReserve(msg.sender, _amount);
    }

    /*//////////////////////////////////////////////////////////////
                        Role Settings
    //////////////////////////////////////////////////////////////*/

    /// @notice Set minter
    /// @param _newMinter newer minter account
    function setMinter(address _newMinter) external onlyAdmin {
        if (_newMinter == address(0)) revert Errors.ZeroAddress();
        minter = _newMinter;
        emit MinterUpdated(_newMinter);
    }

    /// @notice Set burner
    /// @param _newBurner newer burner account
    function setBurner(address _newBurner) external onlyAdmin {
        if (_newBurner == address(0)) revert Errors.ZeroAddress();
        burner = _newBurner;
        emit MinterUpdated(_newBurner);
    }

    /// @notice Set blocklist address
    /// @param _newBlockList newer blocklist contract
    function setBlockList(address _newBlockList) external onlyAdmin {
        address oldBlockList = address(blocklist);
        blocklist = IBlockList(_newBlockList);
        emit BlockListUpdated(oldBlockList, _newBlockList);
    }

    /// @notice Set rebase admin
    /// @param _newRebaseAdmin newer rebase admin account
    function setRebaseAdmin(address _newRebaseAdmin) external onlyAdmin {
        if (_newRebaseAdmin == address(0)) revert Errors.ZeroAddress();
        rebaseAdmin = _newRebaseAdmin;
        emit RebaseAdminUpdated(_newRebaseAdmin);
    }

    /// @notice Set proof of reserve account
    /// @param _newReserve newer reserve account
    function setReserve(address _newReserve) external onlyAdmin {
        if (_newReserve == address(0)) revert Errors.ZeroAddress();
        reserve = _newReserve;
        emit ReserveUpdated(_newReserve);
    }

    /// @notice Set protocol fee receipient
    /// @param _newReceipient new protocol fee receipient
    function setFeeReceipient(address _newReceipient) external onlyAdmin {
        if (_newReceipient == address(0)) revert Errors.ZeroAddress();
        feeReceipient = _newReceipient;
        emit FeeReceipientUpdated(_newReceipient);
    }

    /*//////////////////////////////////////////////////////////////
                        TransferOwnership
    //////////////////////////////////////////////////////////////*/

    function transferAdmin(address _newAdmin) external onlyAdmin {
        if (_newAdmin == address(0)) revert Errors.ZeroAddress();
        pendingAdmin = _newAdmin;

        emit AdminTransferStarted(admin, _newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert OnlyAdmin();

        address oldAdmin = admin;

        admin = pendingAdmin;
        // clear pending admin
        pendingAdmin = address(0);

        emit AdminTransferred(oldAdmin, admin);
    }

    /*//////////////////////////////////////////////////////////////
                    Global Parameter settings
    //////////////////////////////////////////////////////////////*/

    /// @notice Set protocol fee rate
    /// @param _newSubscribeFee new subscription fee rate
    /// @param _newRedeemFee new redeem fee rate
    function setProtocolFee(uint256 _newSubscribeFee, uint256 _newRedeemFee) external onlyAdmin {
        subscribeFee = _newSubscribeFee;
        redeemFee = _newRedeemFee;
        emit ProtocolFeeUpdated(_newSubscribeFee, _newRedeemFee);
    }

    function setMaximumTotalStakingLimit(uint256 _maxStakingLimit) external onlyAdmin {
        maximumTotalStakingLimit = _maxStakingLimit;
        emit MaximumStakingLimitUpdated(_maxStakingLimit);
    }

    /// @notice Set the maximum number of redemption requests
    /// @param _newMaxRedeemSize new maximum redeem size
    function setMaxRedeemQueueSize(uint256 _newMaxRedeemSize) external onlyAdmin {
        maxRedeemQueueSize = _newMaxRedeemSize;
        emit MaxRedeemQueueSizeUpdated(_newMaxRedeemSize);
    }

    function setMinimumSubscribeAmount(uint256 _minSubscribeAmount) external onlyAdmin {
        minimumSubscribeAmount = _minSubscribeAmount;
        emit MinimumSubscribeUpdated(_minSubscribeAmount);
    }

    function setMinimumRedeemAmount(uint256 _minRedeemAmount) external onlyAdmin {
        minimumRedeemAmount = _minRedeemAmount;
        emit MinimumSubscribeUpdated(_minRedeemAmount);
    }

    function setMinimumRedeemInterval(uint256 _minRedeemInterval) external onlyAdmin {
        minimumRedeemInterval = _minRedeemInterval;
        emit MinimumRedeemIntervalUpdated(_minRedeemInterval);
    }

    function setRebaseInterval(uint256 _newRebaseInterval) external onlyAdmin {
        uint256 prevRebaseInterval = rebaseInterval;
        rebaseInterval = _newRebaseInterval;
        emit RebaseIntervalUpdated(prevRebaseInterval, _newRebaseInterval);
    }

    function setRebaseRateLimit(uint256 _newProfitRateLimit, uint256 _newLossRateLimit) external onlyAdmin {
        // Theoretically, the profit rate could be greater than 1, so we do not limit profit rate to be less than REBASE_BASIS_POINTS
        // This is purely theoretical, in most cases, we set the rate limit to prevent unrealistically high profit rate.
        if (_newLossRateLimit > REBASE_BASIS_POINTS) revert InvalidRebaseLimit();

        profitRateLimit = _newProfitRateLimit;
        lossRateLimit = _newLossRateLimit;
        emit RebaseRateLimitUpdated(_newProfitRateLimit, _newLossRateLimit);
    }

    /*//////////////////////////////////////////////////////////////
                        Pause Functions
    //////////////////////////////////////////////////////////////*/

    function pauseSubscription() external onlyMinter {
        subscriptionPaused = true;
        emit SubscriptionPaused(msg.sender);
    }

    function pauseRedemption() external onlyBurner {
        redemptionPaused = true;
        emit RedemptionPaused(msg.sender);
    }

    function unpauseSubscription() external onlyMinter {
        subscriptionPaused = false;
        emit SubscriptionUnpaused(msg.sender);
    }

    function unpauseRedemption() external onlyBurner {
        redemptionPaused = false;
        emit RedemptionUnpaused(msg.sender);
    }

    /// @notice Collecte protocol fee
    /// @param _amount withdraw fee amount
    function collectFee(uint256 _amount) external onlyReceipient nonReentrant {
        protocolFee -= _amount;

        stablecoin.safeTransfer(feeReceipient, _amount);

        emit CollectFee(msg.sender, _amount);
    }

    /// @notice The user available shares, need to deduct all pending redeem shares
    function availableShares(address _account) public view override returns (uint256) {
        return shares[_account] - userPendingRedeemShares[_account];
    }

    /// @notice The user total invested fund in current pool, include confirmed fund (balanceOf) and unconfirmed fund.
    function fundOf(address _account) external view returns (uint256) {
        return balanceOf(_account) + unconfirmedFund[_account];
    }

    /// @notice Total net value, include net value of reserve account  + all buffered fund + unconfirmed fund
    function totalLockedFund() external view returns (uint256) {
        return bufferedFund + reservedFund + totalUnconfirmedFund + transientOutFund - transientInFund;
    }

    function _transferShares(
        address _sender,
        address _recipient,
        uint256 _sharesAmount
    ) internal override notBlocked(_sender) {
        if (_sender == address(0) || _recipient == address(0)) revert Errors.ZeroAddress();
        if (_recipient == address(this)) revert TransferSelfContract();
        if (_sharesAmount > availableShares(_sender)) revert ExceedBalance();

        shares[_sender] -= _sharesAmount;
        shares[_recipient] = shares[_recipient] + _sharesAmount;
    }

    function _getTotalUnderlying() internal view override returns (uint256) {
        return bufferedFund + reservedFund + transientOutFund - transientInFund;
    }

    function _isTDay() internal view returns (bool) {
        return block.timestamp % 86400 <= T0_AVAILABLE;
    }

    /// @notice Only factory owner can upgrade contract
    function _authorizeUpgrade(address) internal override onlyFactory {}

    /*//////////////////////////////////////////////////////////////
                            Modifier
    //////////////////////////////////////////////////////////////*/

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlyRebaseAdmin() {
        if (msg.sender != rebaseAdmin) revert OnlyRebaseAdmin();
        _;
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert OnlyMinter();
        _;
    }

    modifier onlyBurner() {
        if (msg.sender != burner) revert OnlyBurner();
        _;
    }

    modifier onlyReceipient() {
        if (msg.sender != feeReceipient) revert OnlyReceipient();
        _;
    }

    modifier onlyReserve() {
        if (msg.sender != reserve) revert OnlyReserve();
        _;
    }

    modifier notBlocked(address _address) {
        if (address(blocklist) != address(0) && blocklist.isBlocked(_address)) revert AddressBlocked();
        _;
    }

    modifier ifNotPaused(bool feature) {
        if (feature) {
            revert FeaturePaused();
        }
        _;
    }
}
