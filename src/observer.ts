export type Topic =
  | "planets" // Number of planets
  | "renderPlanets"
  | "eccentricity"
  | "ellipseA"
  | "topology"
  | "latBands"
  | "longBands"
  | "enableArmor"
  | "enableTail" // UI setting to enable the rendering of tail
  | "renderTail" // Actually render the tail
  | "collisions" // Number of collisions found
  | "enableCollisions" // UI settings to enable the collisions
  | "checkCollisions" // Actually check the collision in the current frame
  | "pointerEvents" // What has actually changed from the camera parameters (zoom, pan, rotation)
  | "translationSpeed"; // planets translation speed

type Subscriber = {
  id: string;
  callback: (value: unknown) => void;
};

interface IObserver {
  subscribe(topic: Topic, subscriber: Subscriber): void;
  unsubscribe(topic: Topic, subscriber: Subscriber): void;
  notify(topic: Topic, value: unknown): void;
}

export const Observer = (() => {
  let singleton: IObserver | null = null;

  return () => {
    if (singleton) {
      return singleton;
    }

    const subscriptions: Map<Topic, Subscriber[]> = new Map();
    singleton = {
      subscribe: (topic: Topic, subscriber: Subscriber) => {
        const currentSubscribers = subscriptions.get(topic) ?? [];

        // Subscriber already subscribed to topic
        if (currentSubscribers.find((item) => item.id === subscriber.id)) {
          return;
        }

        currentSubscribers.push(subscriber);
        subscriptions.set(topic, currentSubscribers);
      },

      unsubscribe: (topic: Topic, subscriber: Subscriber) => {
        const currentSubscribers = subscriptions.get(topic) ?? [];
        const filteredArray = currentSubscribers.filter(
          (item) => item.id !== subscriber.id,
        );
        subscriptions.set(topic, filteredArray);
      },

      notify: (topic: Topic, value: unknown) => {
        const currentSubscribers = subscriptions.get(topic) ?? [];
        currentSubscribers.forEach((subscriber) => {
          subscriber.callback(value);
        });
      },
    };

    return singleton;
  };
})();
