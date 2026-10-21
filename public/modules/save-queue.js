export function createSaveQueue({ save, onState = () => {} }) {
  let sequence = 0;
  let chain = Promise.resolve();

  return {
    async enqueue(snapshot) {
      const current = ++sequence;
      const run = async () => {
        try {
          await save(snapshot);
          if (current === sequence) onState("saved");
        } catch (error) {
          if (current === sequence) onState("failed", error);
          throw error;
        }
      };
      chain = chain.then(run, run);
      await chain;
    }
  };
}
