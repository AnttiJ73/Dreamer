'use strict';

module.exports = {
  kind: 'execute_method',
  summary: 'Invoke a static C# method by full type and method name. CLI verb: `execute-method`. Escape hatch for capabilities not exposed via first-class commands. Method must be static (public or non-public).',
  requirements: { compilation: true },
  args: {
    typeName: {
      type: 'string',
      required: true,
      cli: '--type',
      description: 'Fully-qualified type name. Class must live in an Editor assembly (or a Runtime assembly the Editor can load).',
    },
    methodName: {
      type: 'string',
      required: true,
      cli: '--method',
      description: 'Method name. Must be static.',
    },
    args: {
      type: 'array',
      cli: '--args',
      description: 'JSON array of argument values. Coerced against the resolved overload\'s parameter types — supports primitives (int, long, float, double, bool, string), enums (by name or numeric), and arrays of the same. Example: `--args \'["Assets/Prefabs/A.prefab",5,true]\'`.',
    },
  },
  result: {
    type: 'object',
    fields: {
      executed: { type: 'boolean' },
      typeName: { type: 'string' },
      methodName: { type: 'string' },
      result: { type: 'any', description: 'Stringified return value (null if void).' },
    },
  },
  examples: [
    {
      title: 'Parameterless build method',
      cli: './bin/dreamer execute-method --type "MyTools.AssetBuilder" --method "BuildAll" --wait',
      args: { typeName: 'MyTools.AssetBuilder', methodName: 'BuildAll' },
    },
    {
      title: 'Method taking a string + int',
      cli: './bin/dreamer execute-method --type "Game.Tools" --method "RenameAll" --args \'["Assets/Prefabs",10]\' --wait',
      args: { typeName: 'Game.Tools', methodName: 'RenameAll', args: ['Assets/Prefabs', 10] },
    },
    {
      title: 'Method taking a string array',
      cli: './bin/dreamer execute-method --type "Game.Audit" --method "Compare" --args \'[["A.prefab","B.prefab"]]\' --wait',
      args: { typeName: 'Game.Audit', methodName: 'Compare', args: [['A.prefab', 'B.prefab']] },
    },
  ],
  pitfalls: [
    'Method overload resolution matches by NAME + ARG COUNT — if you have two overloads with the same arity, the first found wins.',
    '`--args` must be a JSON ARRAY at the outer level, even for one argument: `[42]` not `42`.',
    'Type coercion uses Convert.ChangeType — JSON `42` (long) becomes `int`, `42.0` becomes `float`, etc. Enum args accept the enum name as a string.',
    'Editor-only types resolve fine (UnityEditor.*); runtime-only types are also reachable from the Editor domain.',
    'The method returns its result stringified via `.ToString()` — for structured return values, have your method serialize JSON and the result field will carry it as a string.',
  ],
};
