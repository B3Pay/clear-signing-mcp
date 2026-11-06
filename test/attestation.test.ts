import {
  computeDescriptorHash,
  type ChainClient,
} from "@ethereum-sourcify/clear-signing"
import { toFunctionSelector } from "viem"
import { describe, expect, it } from "vitest"
import {
  checkAttestations,
  DEFAULT_ATTESTERS,
  describeAttestation,
  type Attester,
} from "../src/attestation.js"
import { RegistryClient } from "../src/registry.js"
import {
  attestationUrl,
  easReader,
  newAuditor,
  registryWeb,
  signAttestation,
  TOKEN,
  TOKEN_DESCRIPTOR_PATH,
  tokenDescriptor,
  type FakeWeb,
} from "./helpers.js"

const EAS = "0xa1207f3bba224e2c9c3c6d5af63d0eb1582ce587"

function check(
  web: FakeWeb,
  attesters: readonly Attester[],
  chainClient?: ChainClient
) {
  return checkAttestations({
    registry: new RegistryClient({ fetch: web.fetch }),
    descriptorPath: TOKEN_DESCRIPTOR_PATH,
    descriptor: tokenDescriptor(),
    attesters,
    ...(chainClient ? { chainClient } : {}),
    chainId: 1,
    address: TOKEN,
  })
}

async function publish(
  web: FakeWeb,
  attester: Attester,
  file: unknown
): Promise<void> {
  web.json(attestationUrl(TOKEN_DESCRIPTOR_PATH, attester.address), await file)
}

describe("checkAttestations", () => {
  const descriptorHash = computeDescriptorHash(tokenDescriptor())

  it("reports attested when a trusted auditor's attestation verifies and is not revoked", async () => {
    const auditor = newAuditor()
    const web = registryWeb()
    await publish(
      web,
      auditor.attester,
      signAttestation(auditor.account, tokenDescriptor())
    )
    const reader = easReader(false)

    const report = await check(web, [auditor.attester], reader)

    expect(report).toEqual({
      status: "attested",
      descriptorHash,
      attesters: [auditor.attester],
    })
    expect(reader.calls).toHaveLength(1)
    const [call] = reader.calls
    expect(call?.chainId).toBe(1)
    expect(call?.to.toLowerCase()).toBe(EAS)
    expect(
      call?.data.startsWith(
        toFunctionSelector("getRevokeOffchain(address,bytes32)")
      )
    ).toBe(true)
    expect(call?.data).toContain(auditor.account.address.slice(2).toLowerCase())
    expect(describeAttestation(report)).toBe(
      `attested by Test Auditor ${auditor.account.address} (ERC-8176, verified, not revoked)`
    )
  })

  it("reports invalid when the attestation was revoked", async () => {
    const auditor = newAuditor()
    const web = registryWeb()
    await publish(
      web,
      auditor.attester,
      signAttestation(auditor.account, tokenDescriptor())
    )

    const report = await check(web, [auditor.attester], easReader(true))

    expect(report.status).toBe("invalid")
    expect(report.status === "invalid" && report.detail).toMatch(/was revoked/)
  })

  it("reports invalid when the attestation is over another descriptor", async () => {
    const auditor = newAuditor()
    const web = registryWeb()
    const other = `0x${"11".repeat(32)}` as const
    await publish(
      web,
      auditor.attester,
      signAttestation(auditor.account, tokenDescriptor(), {
        descriptorHash: other,
      })
    )

    const report = await check(web, [auditor.attester], easReader(false))

    expect(report.status).toBe("invalid")
    expect(report.status === "invalid" && report.detail).toMatch(
      /does not match the computed hash/
    )
  })

  it("reports invalid when the attestation expired", async () => {
    const auditor = newAuditor()
    const web = registryWeb()
    await publish(
      web,
      auditor.attester,
      signAttestation(auditor.account, tokenDescriptor(), {
        expirationTime: 1_700_000_000n,
      })
    )

    const report = await check(web, [auditor.attester], easReader(false))

    expect(report.status).toBe("invalid")
    expect(report.status === "invalid" && report.detail).toMatch(/expired/)
  })

  it("reports invalid when someone else signed the file at the auditor's path", async () => {
    const auditor = newAuditor()
    const impostor = newAuditor()
    const web = registryWeb()
    await publish(
      web,
      auditor.attester,
      signAttestation(impostor.account, tokenDescriptor())
    )

    const report = await check(web, [auditor.attester], easReader(false))

    expect(report.status).toBe("invalid")
    expect(report.status === "invalid" && report.detail).toMatch(/signed by/)
  })

  it("reports invalid when the signature was tampered with", async () => {
    const auditor = newAuditor()
    const web = registryWeb()
    const file = (await signAttestation(
      auditor.account,
      tokenDescriptor()
    )) as {
      sig: { message: { salt: string } }
    }
    file.sig.message.salt = `0x${"22".repeat(32)}`
    await publish(web, auditor.attester, file)

    const report = await check(web, [auditor.attester], easReader(false))

    expect(report.status).toBe("invalid")
  })

  it("reports not attested when no trusted auditor published a file", async () => {
    const auditor = newAuditor()
    const reader = easReader(false)

    const report = await check(registryWeb(), [auditor.attester], reader)

    expect(report).toEqual({
      status: "not_attested",
      descriptorHash,
      checked: [auditor.attester],
    })
    expect(reader.calls).toEqual([])
    expect(describeAttestation(report)).toBe(
      "not attested by a trusted auditor"
    )
  })

  it("does not trust an auditor that is not on the list", async () => {
    const listed = newAuditor()
    const unlisted = newAuditor()
    const web = registryWeb()
    await publish(
      web,
      unlisted.attester,
      signAttestation(unlisted.account, tokenDescriptor())
    )

    const report = await check(web, [listed.attester], easReader(false))

    expect(report.status).toBe("not_attested")
  })

  it("counts only the auditors whose attestation verifies", async () => {
    const first = newAuditor()
    const second = newAuditor()
    const web = registryWeb()
    await publish(
      web,
      second.attester,
      signAttestation(second.account, tokenDescriptor())
    )

    const report = await check(
      web,
      [first.attester, second.attester],
      easReader(false)
    )

    expect(report).toEqual({
      status: "attested",
      descriptorHash,
      attesters: [second.attester],
    })
  })

  it("leaves a file unchecked when there is no Ethereum mainnet access for the revocation check", async () => {
    const auditor = newAuditor()
    const web = registryWeb()
    await publish(
      web,
      auditor.attester,
      signAttestation(auditor.account, tokenDescriptor())
    )

    const report = await check(web, [auditor.attester])

    expect(report.status).toBe("unchecked")
    expect(report.status === "unchecked" && report.filesFrom).toEqual([
      auditor.attester,
    ])
    expect(describeAttestation(report)).toMatch(
      /not checked: .*Ethereum mainnet RPC/
    )
  })

  it("leaves a file unchecked when the revocation check fails, rather than calling it attested", async () => {
    const auditor = newAuditor()
    const web = registryWeb()
    await publish(
      web,
      auditor.attester,
      signAttestation(auditor.account, tokenDescriptor())
    )
    const down: ChainClient = {
      call: () => Promise.reject(new Error("connection refused")),
    }

    const report = await check(web, [auditor.attester], down)

    expect(report.status).toBe("unchecked")
    expect(report.status === "unchecked" && report.reason).toMatch(
      /revocation check .* failed: connection refused/
    )
  })

  it("lists the registry's auditor by default, checksummed", () => {
    expect(DEFAULT_ATTESTERS).toEqual([
      {
        address: "0x3846c3A30E62075Fa916216b35EF04B8F53931f6",
        name: "Cyfrin (Patrick Collins)",
      },
    ])
  })
})
