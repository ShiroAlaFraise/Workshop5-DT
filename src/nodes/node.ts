import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { broadcastMessage, delay } from "../utils";

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  type NodeState = {
    killed: boolean;
    x: 0 | 1 | "?" | null;
    decided: boolean | null;
    k: number | null;
  };

  let nodeState: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  let receivedMessages: { step: number; value: Value }[] = [];

  node.get("/status", (req, res) => {
    res.status(isFaulty ? 500 : 200).send(isFaulty ? "faulty" : "live");
  });

  node.get("/getState", (req, res) => {
    res.json(nodeState);
  });

  node.get("/start", async (req, res) => {
    if (nodeState.killed) {
      res.status(500).send("Node stopped");
      return;
    }
  
    while (!nodesAreReady()) {
      await delay(100);
    }
  
    let step = 0;
  
    // Initialisation : envoi des messages aux autres nœuds sans attendre de réponse
    broadcastMessage(nodeId, N, step, nodeState);
  
    res.send("Initialization complete, waiting for consensus...");
  });
  
  node.post("/message", (req, res) => {
    if (nodeState.killed) {
      res.status(500).send("Node stopped");
      return;
    }
  
    const { step, value } = req.body;
  
    if (!isFaulty && nodeState.k === step) {
      receivedMessages.push({ step, value });
    }
  
    if (receivedMessages.length === N - 1) {
      const voteCounts: Record<string, number> = {};
  
      receivedMessages.forEach(({ value }) => {
        if (value !== "?") {
          voteCounts[value] = (voteCounts[value] || 0) + 1;
        }
      });
  
      const majorityValue = Object.keys(voteCounts).length
        ? Object.keys(voteCounts).reduce((a, b) =>
            voteCounts[a] > voteCounts[b] ? a : b
          )
        : null;
  
      if (majorityValue !== null && voteCounts[majorityValue] > (N - F) / 2) {
        nodeState.x = parseInt(majorityValue, 10) as Value; // Convertir en nombre
        nodeState.decided = true;
      }
  
      // On passe à l'étape suivante
      if (nodeState.k !== null) {
        nodeState.k++;
      } else {
        nodeState.k = 1; // Initialiser à 1 si null
      }
    }
  
    res.sendStatus(200);
  });
  

  node.get("/stop", (req, res) => {
    nodeState.killed = true;
    res.send("Node stopped");
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}
