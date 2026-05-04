import { it, expect, describe } from "vitest";
import { Graph, GraphMarkers } from "../src/index";

describe("Graph Modes", () => {
	it("runs synchronous one-to-one flow with self callNode redirection", async () => {
		const graph = new Graph({ invokeTimes: 0, sequence: [] as string[] });

		graph
			.addNode("node_1", (graphState) => {
				const nextState = {
					...graphState,
					sequence: [...graphState.sequence, "node_1"],
					invokeTimes: graphState.invokeTimes + 1
				};

				if (graphState.invokeTimes === 0) {
					return {
						stateUpdate: nextState,
						callNode: "node_1"
					};
				}

				return {
					stateUpdate: nextState
				};
			})
			.addNode("node_2", (graphState) => ({
				stateUpdate: {
					...graphState,
					sequence: [...graphState.sequence, "node_2"],
					invokeTimes: graphState.invokeTimes + 1
				}
			}))
			.addEdge(GraphMarkers.START, "node_1")
			.addEdge("node_1", "node_2")
			.addEdge("node_2", GraphMarkers.END);

		await graph.start();

		expect(graph.getState().invokeTimes).toBe(3);
		expect(graph.getState().sequence).toStrictEqual(["node_1", "node_1", "node_2"]);
	});

	it("supports synchronous multiple-to-multiple and multiple-to-one gating", async () => {
		const graph = new Graph({ order: [] as string[] });

		graph
			.addNode("node_a", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_a"]
				}
			}))
			.addNode("node_b", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_b"]
				}
			}))
			.addNode("node_c", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_c"]
				}
			}))
			.addNode("node_d", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_d"]
				}
			}))
			.addNode("node_e", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_e"]
				}
			}))
			.addEdge(GraphMarkers.START, ["node_a", "node_b"])
			.addEdge(["node_a", "node_b"], ["node_c", "node_d"])
			.addEdge(["node_c", "node_d"], "node_e")
			.addEdge("node_e", GraphMarkers.END);

		await graph.start();

		expect(graph.getState().order).toStrictEqual(["node_a", "node_b", "node_c", "node_d", "node_e"]);
	});

	it("triggers asynchronous edges after each source node execution", async () => {
		const graph = new Graph({ cRuns: 0, dRuns: 0, order: [] as string[] });

		graph
			.addNode("node_a", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_a"]
				}
			}))
			.addNode("node_b", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_b"]
				}
			}))
			.addNode("node_c", (graphState) => ({
				stateUpdate: {
					...graphState,
					cRuns: graphState.cRuns + 1,
					order: [...graphState.order, "node_c"]
				}
			}))
			.addNode("node_d", (graphState) => ({
				stateUpdate: {
					...graphState,
					dRuns: graphState.dRuns + 1,
					order: [...graphState.order, "node_d"]
				}
			}))
			.addEdge(GraphMarkers.START, ["node_a", "node_b"])
			.addEdge(["node_a", "node_b"], "node_c", { asynchronous: true })
			.addEdge(["node_a", "node_b"], "node_d")
			.addEdge("node_d", GraphMarkers.END);

		await graph.start();

		expect(graph.getState().cRuns).toBe(2);
		expect(graph.getState().dRuns).toBe(1);
		expect(graph.getState().order).toStrictEqual(["node_a", "node_b", "node_c", "node_c", "node_d"]);
	});

	it("returns from callNode redirection to caller edge distribution", async () => {
		const graph = new Graph({ order: [] as string[], trapRuns: 0 });

		graph
			.addNode("node_1", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_1"]
				},
				callNode: ["node_2", "node_3"]
			}))
			.addNode("node_2", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_2"]
				}
			}))
			.addNode("node_3", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_3"]
				}
			}))
			.addNode("node_4", (graphState) => ({
				stateUpdate: {
					...graphState,
					order: [...graphState.order, "node_4"]
				}
			}))
			.addNode("node_trap", (graphState) => ({
				stateUpdate: {
					...graphState,
					trapRuns: graphState.trapRuns + 1,
					order: [...graphState.order, "node_trap"]
				}
			}))
			.addEdge(GraphMarkers.START, "node_1")
			.addEdge("node_1", "node_4")
			.addEdge("node_2", "node_trap")
			.addEdge("node_4", GraphMarkers.END);

		await graph.start();

		expect(graph.getState().order).toStrictEqual(["node_1", "node_2", "node_3", "node_4"]);
		expect(graph.getState().trapRuns).toBe(0);
	});
});

