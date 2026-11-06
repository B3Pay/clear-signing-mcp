# Draft: ExchangeRouter on chain 42161

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 42161:0x7dE39FF2e232A2203196788d37e234cF8F1b83f1
- Protocol: gmx
- Owner: GMX, https://gmx.io
- ABI: sourcify, ExchangeRouter at 0x7dE39FF2e232A2203196788d37e234cF8F1b83f1
- Descriptor: calldata-ExchangeRouter.json; tests: testsv2/calldata-ExchangeRouter.tests.json (3)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xac9650d8 multicall: 194 senders, 938 calls, 79.8% of senders.
- 0xc41b1ab3 claimFundingFees: 45 senders, 51 calls, 18.5% of senders.
- 0x7489ec23 cancelOrder: 2 senders, 9 calls, 0.8% of senders.
- The draft describes 3 function(s): 99.2% of the sample's 243 senders per function called.

- `multicall(bytes[] data)`: Multicall
- `claimFundingFees(address[] markets,address[] tokens,address receiver)`: Claim funding fees
- `cancelOrder(bytes32 key)`: Cancel order

## Review notes

- multicall (0xac9650d8): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
- multicall (0xac9650d8), tx 0x84d7b4b8579d84d16dd1795203a56a37095a8aa43c7652faf33cf6b4a1a50835: "Action" shows "0xdd5baad26505e9df22461ec1834eb1d1bd437016bde9c4324d59b8cb14c30c2d082da7beffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000302ab5fcc00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001": raw call data: the call it carries did not render (NO_FORMAT_MATCH).
