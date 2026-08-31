import {
  bindBrokerageActivities,
  startWorkflowIdempotently,
} from "../dist/index.js";

const calls = [];
const temporal = {
  async start(name, options) {
    calls.push([name, options.workflowId]);
  },
};
if (
  (await startWorkflowIdempotently(temporal, "MatchWorkflow", {
    taskQueue: "production",
    workflowId: "match:1",
    args: [{ offerId: "1", demandId: "2" }],
  })) !== "STARTED"
)
  throw new Error("new workflow was not started");

const replayTemporal = {
  async start() {
    const error = new Error("already exists");
    error.name = "WorkflowExecutionAlreadyStartedError";
    throw error;
  },
};
if (
  (await startWorkflowIdempotently(replayTemporal, "MatchWorkflow", {
    taskQueue: "production",
    workflowId: "match:1",
    args: [{ offerId: "1", demandId: "2" }],
  })) !== "ALREADY_STARTED"
)
  throw new Error("workflow replay was not acknowledged");

let unrelatedRejected = false;
try {
  await startWorkflowIdempotently(
    {
      async start() {
        throw new TypeError("connection failed");
      },
    },
    "MatchWorkflow",
    {
      taskQueue: "production",
      workflowId: "match:2",
      args: [{ offerId: "1", demandId: "2" }],
    },
  );
} catch {
  unrelatedRejected = true;
}
if (!unrelatedRejected) throw new Error("unrelated Temporal error was hidden");

const service = {};
for (const method of [
  "discoverSupplier",
  "discoverBuyer",
  "qualify",
  "match",
  "negotiate",
  "protect",
  "lockSettlement",
  "releaseIdentity",
  "monitorShipment",
  "reconcile",
  "recur",
]) {
  service[method] = function () {
    if (this !== service) throw new Error(`activity receiver lost:${method}`);
    return Promise.resolve(method);
  };
}
const activities = bindBrokerageActivities(service);
if ((await activities.match({ offerId: "1", demandId: "2" })) !== "match")
  throw new Error("bound activity did not call service");

console.log(
  `TEMPORAL_DELIVERY_OK starts=${calls.length} replay=acknowledged unrelated_error=rejected activities=bound`,
);
