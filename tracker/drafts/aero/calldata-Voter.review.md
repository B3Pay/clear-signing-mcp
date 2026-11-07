# Draft: Voter on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6
- Protocol: aero
- Owner: Aero (Aerodrome + Velodrome), https://aero.xyz
- ABI: sourcify, Voter at 0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6
- Descriptor: calldata-Voter.json; tests: testsv2/calldata-Voter.tests.json (3)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xf02e634e allocate: 225 senders, 539 calls, 54.2% of senders.
- 0x28b54326 claimRewards: 184 senders, 445 calls, 44.3% of senders.
- 0x5011bf07 allocateGauges: 5 senders, 14 calls, 1.2% of senders.
- The draft describes 3 function(s): 99.8% of the sample's 415 senders per function called.

- `allocate(uint256 _tokenId,(uint256 chainId,uint128 delta,uint256 gasLimit,uint256 value)[] _chainDispatches,(uint256 chainId,uint256 gasLimit,uint256 value,(address gauge,uint128 allocated,bytes data)[] gauges)[] _gaugeDispatches,address _refundRecipient)`: Allocate
- `claimRewards(uint256 _tokenId,(uint256 chainId,uint256 gasLimit,uint256 value,address recipient,(address votingRewardsManager,uint256 maxCheckpoints)[] feeClaims,(address votingRewardsManager,uint256 programId,uint256 maxCheckpoints)[] incentiveClaims)[] _claimRewardsParams,address _refundRecipient)`: Claim rewards
- `allocateGauges(uint256 _tokenId,uint256 _chainId,(address gauge,uint128 allocated,bytes data)[] _gauges,uint256 _gasLimit,address _refundRecipient)`: Allocate gauges

## Review notes

- allocate (0xf02e634e): _chainDispatches.[].value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- allocate (0xf02e634e): _gaugeDispatches.[].value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- allocate (0xf02e634e): _gaugeDispatches.[].gauges.[] is hidden: the draft does not display an array of structs inside an array of structs (the clear-signing library expands one [] per path).
- claimRewards (0x28b54326): _claimRewardsParams.[].value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- claimRewards (0x28b54326): _claimRewardsParams.[].feeClaims.[] is hidden: the draft does not display an array of structs inside an array of structs (the clear-signing library expands one [] per path).
- claimRewards (0x28b54326): _claimRewardsParams.[].incentiveClaims.[] is hidden: the draft does not display an array of structs inside an array of structs (the clear-signing library expands one [] per path).
- allocateGauges (0x5011bf07): _gauges.[].data looks like call data, but no parameter names the contract it calls: it is shown raw.
