import { blankComponent, componentDescriptions, componentIcons, componentLabels, componentTypes, type ComponentType, type SaverComponent } from "./types";

export interface ComponentDefinition {
  type: ComponentType;
  label: string;
  icon: string;
  description: string;
  create: () => SaverComponent;
}

export const componentRegistry: ComponentDefinition[] = componentTypes.map((type) => ({
  type, label: componentLabels[type], icon: componentIcons[type], description: componentDescriptions[type], create: () => blankComponent(type),
}));

export const componentDefinition = (type: ComponentType) => componentRegistry.find((item) => item.type === type) ?? componentRegistry[0];
