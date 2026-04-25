'use strict';

module.exports = {
  kind: 'execute_method',
  summary: 'Invoke a static C# method by full type and method name (e.g. "MyTools.BuildAtlas"). CLI verb: `execute-method`. Last-resort escape hatch for capabilities not exposed via Dreamer\'s first-class commands. Method must be public static, parameterless (or all-defaultable). NO argument-passing yet — surface a request for a proper command instead of building elaborate static-method workarounds.',
  requirements: { compilation: true },
  args: {
    typeName: {
      type: 'string',
      required: true,
      cli: '--type',
      description: 'Fully-qualified type name. The class must be in an Editor assembly (or a Runtime assembly the Editor can load).',
    },
    methodName: {
      type: 'string',
      required: true,
      cli: '--method',
      description: 'Method name. Must be public static.',
    },
  },
  result: {
    type: 'object',
    fields: {
      executed: { type: 'boolean' },
      typeName: { type: 'string' },
      methodName: { type: 'string' },
      returnValue: { type: 'any', description: 'Stringified return value, if the method returned anything.' },
    },
  },
  examples: [
    {
      title: 'Call a custom build method',
      cli: './bin/dreamer execute-method --type "MyTools.AssetBuilder" --method "BuildAll" --wait',
      args: { typeName: 'MyTools.AssetBuilder', methodName: 'BuildAll' },
    },
  ],
};
