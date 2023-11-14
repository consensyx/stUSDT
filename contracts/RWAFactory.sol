//SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

import "./RWAPool.sol";
import "./utils/Errors.sol";
import "./interfaces/IRWAFactory.sol";

contract RWAFactory is IRWAFactory, Ownable2Step {
    /// @notice all deployed RWAPool instances
    address[] public override pools;

    bytes4 public constant INITIALIZE_SELECTOR =
        bytes4(keccak256(bytes("initialize(string,string,address,address,address,address,address,address,address)")));

    bytes4 public constant UPGRADE_SELECTOR = bytes4(keccak256(bytes("upgradeTo(address)")));

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
    ) external override onlyOwner returns (address pool, uint256 poolId) {
        pool = address(new RWAPool());

        pool = address(
            new ERC1967Proxy(
                pool, //implementation
                abi.encodeWithSelector(
                    INITIALIZE_SELECTOR,
                    _name,
                    _symbol,
                    _stablecoin,
                    _admin,
                    _minter,
                    _burner,
                    _rebaseAdmin,
                    _reserve,
                    _receipient
                )
            )
        );

        pools.push(pool);
        poolId = pools.length - 1;

        emit PoolCreated(pool, poolId);
    }

    function upgradePools(address[] calldata _pools, address[] calldata _implementations) external override onlyOwner {
        if (_pools.length != _implementations.length) revert PoolsLengthMismatch();

        for (uint256 i = 0; i < _pools.length; i++) {
            _upgrade(_pools[i], _implementations[i]);
        }
    }

    function _upgrade(address _pool, address _implementation) internal {
        (bool success, ) = _pool.call(abi.encodeWithSelector(UPGRADE_SELECTOR, _implementation));

        if (!success) revert UpgradeFailed();
        emit PoolUpgraded(_pool, _implementation);
    }
}
