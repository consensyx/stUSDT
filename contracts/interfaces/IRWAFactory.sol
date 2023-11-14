//SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

interface IRWAFactory {
    error UpgradeFailed();
    error PoolsLengthMismatch();

    event PoolCreated(address indexed pool, uint256 pid);
    event PoolUpgraded(address indexed pool, address implementation);

    function pools(uint256 poolId) external returns (address);

    function createPool(
        string memory _name,
        string memory _symbol,
        address _stablecoin,
        address _admin,
        address _minter,
        address _burner,
        address _rebaseAdmin,
        address _reserve,
        address _receipient
    ) external returns (address pool, uint256 poolId);

    function upgradePools(address[] calldata _pools, address[] calldata _implementationss) external;
}
