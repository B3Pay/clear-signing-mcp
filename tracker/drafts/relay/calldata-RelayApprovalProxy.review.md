# Draft: RelayApprovalProxy on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x5567954cD026CEbFE486062cb75848e0f1c12E58
- Protocol: relay
- Owner: Relay, https://relay.link
- ABI: sourcify, RelayApprovalProxy at 0x5567954cD026CEbFE486062cb75848e0f1c12E58
- Descriptor: calldata-RelayApprovalProxy.json; tests: testsv2/calldata-RelayApprovalProxy.tests.json (2)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xf9e4bab4 transferAndMulticall: 498 senders, 615 calls, 92.2% of senders.
- 0x0a2b8f36 permit2TransferAndMulticall: 41 senders, 378 calls, 7.6% of senders.
- The draft describes 2 function(s): 99.8% of the sample's 540 senders per function called.

- `transferAndMulticall(address[] tokens,uint256[] amounts,(address target,bool allowFailure,uint256 value,bytes callData)[] calls,address refundTo,address nftRecipient,bytes metadata)`: Transfer and multicall
- `permit2TransferAndMulticall(address user,((address token,uint256 amount)[] permitted,uint256 nonce,uint256 deadline) permit,(address target,bool allowFailure,uint256 value,bytes callData)[] calls,address refundTo,address nftRecipient,bytes metadata,bytes permitSignature)`: Permit 2 transfer and multicall

## Review notes

- transferAndMulticall (0xf9e4bab4): calls.[].value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- transferAndMulticall (0xf9e4bab4): calls.[].callData is a call to calls.[].target: a wallet shows it through that contract's descriptor.
- transferAndMulticall (0xf9e4bab4): metadata (bytes) is shown raw.
- transferAndMulticall (0xf9e4bab4): tokens.[] is hidden: the amount counted in it shows its symbol.
- permit2TransferAndMulticall (0x0a2b8f36): calls.[].value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- permit2TransferAndMulticall (0x0a2b8f36): calls.[].callData is a call to calls.[].target: a wallet shows it through that contract's descriptor.
- permit2TransferAndMulticall (0x0a2b8f36): metadata (bytes) is shown raw.
- permit2TransferAndMulticall (0x0a2b8f36): permitSignature is hidden: a signature is not for reading.
- permit2TransferAndMulticall (0x0a2b8f36): permit.permitted.[].token is hidden: the amount counted in it shows its symbol.
- transferAndMulticall (0xf9e4bab4), tx 0x47edde0058c0fb36fafa997f0c58b4649f457f958ce37460b0813eadfb5d619c: "Action" shows "0x095ea7b30000000000000000000000006131b5fae19ea4f9d964eac0408e4408b66337b5000000000000000000000000000000000000000000000009e9529ae234a81bc5": raw call data: the call it carries did not render (NO_DESCRIPTOR).
- transferAndMulticall (0xf9e4bab4), tx 0x47edde0058c0fb36fafa997f0c58b4649f457f958ce37460b0813eadfb5d619c: "Action" shows "0x5d1fe6a200000000000000000000000000000000000000000000000000000000000000000000000000000000000000004cd00e387622c35bddb9b4c962c136462338bc310000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000004449290c1c000000000000000000000000479fd93e990688f226f97ff343011800f4f785cda1ad07f7f62b4163dfa0641c413db29b057a5a1d757daf7a14969c6cc8fc2e8e00000000000000000000000000000000000000000000000000000000": raw call data: the call it carries did not render (NO_DESCRIPTOR).
- permit2TransferAndMulticall (0x0a2b8f36), tx 0x2ab4145c06f6cc314beca766a88ee278c9ea70beeb61012072ce6b30c6ef1c0c: "Action" shows "0x095ea7b30000000000000000000000006131b5fae19ea4f9d964eac0408e4408b66337b50000000000000000000000000000000000000000000000000000000005eb8035": raw call data: the call it carries did not render (NO_DESCRIPTOR).
- permit2TransferAndMulticall (0x0a2b8f36), tx 0x2ab4145c06f6cc314beca766a88ee278c9ea70beeb61012072ce6b30c6ef1c0c: "Action" shows "0x9bb43718000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000b2000000000000000000007b9fcbd005511acbd50000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ffe6a865440967ad098a14eff7007aee8a947f320000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000218c1e3b36cfbf6e820cfdb9bb69e06cff6bbb875d9945359ebd337313349939710000000000000000000000000000000000000000000000000000000000000000": raw call data: the call it carries did not render (NO_DESCRIPTOR).
