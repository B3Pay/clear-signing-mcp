# Draft: RelayRouter on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x0729E2a4716d9f7dD17858d5d504426D228697f7
- Protocol: relay
- Owner: Relay, https://relay.link
- ABI: sourcify, RelayRouter at 0x0729E2a4716d9f7dD17858d5d504426D228697f7
- Descriptor: calldata-RelayRouter.json; tests: testsv2/calldata-RelayRouter.tests.json (1)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xcd6e13f7 multicall: 417 senders, 911 calls, 99.8% of senders.
- The draft describes 1 function(s): 99.8% of the sample's 418 senders per function called.

- `multicall((address target,bool allowFailure,uint256 value,bytes callData)[] calls,address refundTo,address nftRecipient,bytes metadata)`: Multicall

## Review notes

- multicall (0xcd6e13f7): calls.[].value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- multicall (0xcd6e13f7): calls.[].callData is a call to calls.[].target: a wallet shows it through that contract's descriptor.
- multicall (0xcd6e13f7): metadata (bytes) is shown raw.
- multicall (0xcd6e13f7), tx 0xeeb1e083e14eca4b4b367a8c7a77eac23d625ec69201dff41baf190488dab43b: "Action" shows "0x": raw call data: the call it carries did not render (CALLDATA_TOO_SHORT).
