# Materials & shaders

Materials use Unity's `MaterialProperty` API rather than standard serialization, so `set-property` doesn't reach them cleanly. Use the dedicated commands.

## Materials

```bash
# Create a new material (defaults to Standard / URP-Lit / HDRP-Lit if --shader omitted)
./bin/dreamer create-material --name PlayerMat --path Assets/Materials --shader "Universal Render Pipeline/Lit" --wait

# Inspect: returns shader name, every property (name + type + current value + range),
# active keywords, render queue. Run this BEFORE set-material-property to see real names.
./bin/dreamer inspect-material --asset Assets/Materials/PlayerMat.mat --wait

# Set properties. Value format follows the inspector output's type.
./bin/dreamer set-material-property --asset Assets/Materials/PlayerMat.mat --property _BaseColor --value '{"r":1,"g":0,"b":0,"a":1}' --wait
./bin/dreamer set-material-property --asset Assets/Materials/PlayerMat.mat --property _Smoothness --value 0.5 --wait
./bin/dreamer set-material-property --asset Assets/Materials/PlayerMat.mat --property _BaseMap --value '{"assetRef":"Assets/Textures/Player.png"}' --wait

# Toggle shader keywords (features like _EMISSION, _NORMALMAP, _ALPHATEST_ON).
./bin/dreamer set-material-property --asset Assets/Materials/PlayerMat.mat --keyword _EMISSION --enable true --wait

# Reassign shader. Unity preserves compatible property values.
./bin/dreamer set-material-shader --asset Assets/Materials/PlayerMat.mat --shader "Universal Render Pipeline/Unlit" --wait
```

## Shader diagnostics

```bash
# Single shader: compile errors + warnings from ShaderUtil.GetShaderMessages
./bin/dreamer shader-status --asset Assets/Shaders/MyEffect.shader --wait

# Project-wide scan — finds every user shader with messages
./bin/dreamer shader-status --wait

# Describe a shader's declared interface (properties, keywords, render queue)
./bin/dreamer inspect-shader --asset Assets/Shaders/MyEffect.shader --wait
./bin/dreamer inspect-shader --shader "Universal Render Pipeline/Lit" --wait
```

Writing shader source files is the same as writing `.cs`: use your file-edit tool to write the `.shader`, then `./bin/dreamer refresh-assets --wait`, then `shader-status` to check for compile errors. There is no `create-shader` command — templates vary too much per render pipeline to be useful from Dreamer.
