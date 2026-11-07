# Draft: Spoke on chain 1

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 1:0x94e7A5dCbE816e498b89aB752661904E2F56c485
- Protocol: aave-v4
- Owner: Aave v4, https://aave.com
- ABI: sourcify, SpokeInstance at 0xABd0E26FE17BDe4F1f1187Ed8aA80C274E03D8b5
- Descriptor: calldata-Spoke.json; tests: testsv2/calldata-Spoke.tests.json (7)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xac9650d8 multicall: 258 senders, 403 calls, 37.6% of senders.
- 0xd6bda0c0 borrow: 180 senders, 287 calls, 26.2% of senders.
- 0x0ad58d2f withdraw: 143 senders, 187 calls, 20.8% of senders.
- 0x8874e104 setUserPositionManager: 31 senders, 32 calls, 4.5% of senders.
- 0x852a56a5 supply: 30 senders, 41 calls, 4.4% of senders.
- 0xb1e8f8ef repay: 27 senders, 33 calls, 3.9% of senders.
- 0x826002e2 updateUserDynamicConfig: 12 senders, 12 calls, 1.7% of senders.
- The draft describes 7 function(s): 99.3% of the sample's 686 senders per function called.

- `multicall(bytes[] data)`: Multicall
- `borrow(uint256 reserveId,uint256 amount,address onBehalfOf)`: Borrow
- `withdraw(uint256 reserveId,uint256 amount,address onBehalfOf)`: Withdraw
- `setUserPositionManager(address positionManager,bool approve)`: Set user position manager
- `supply(uint256 reserveId,uint256 amount,address onBehalfOf)`: Supply
- `repay(uint256 reserveId,uint256 amount,address onBehalfOf)`: Repay
- `updateUserDynamicConfig(address onBehalfOf)`: Update user dynamic config

## Review notes

- multicall (0xac9650d8): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
- borrow (0xd6bda0c0): amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- withdraw (0x0ad58d2f): amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- supply (0x852a56a5): amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- repay (0xb1e8f8ef): amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- multicall (0xac9650d8), tx 0x82af2f04a227b4542fbf16c5207cdbdaeaadfed24aef40eff451b4ae5cd4f46b: "Action" shows "0x9e35c53300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000001000000000000000000000000eeb9afb4ed985addd7615d59e4aa1f3377c6a56a": raw call data: the call it carries did not render (NO_FORMAT_MATCH).
