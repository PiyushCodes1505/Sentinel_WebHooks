import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRetryDelaySeconds } from "../lib/retry";

describe("retry policy",()=>{
  it("uses exponential growth with a configured cap",()=>{
    process.env.BASE_RETRY_DELAY_SECONDS="1";
    process.env.MAX_RETRY_DELAY_SECONDS="10";
    const values=[1,2,3,4].map(n=>computeRetryDelaySeconds(n,0));
    assert.ok(values[0]>=1&&values[0]<=2);
    assert.ok(values[1]>=2&&values[1]<=3);
    assert.ok(values[2]>=4&&values[2]<=5);
    assert.ok(values[3]>=8&&values[3]<=10);
  });

  it("honors retry-after when supplied",()=>{
    const value=computeRetryDelaySeconds(1,7);
    assert.ok(value>=7&&value<=9);
  });
});
