from dify_plugin import DifyPluginEnv, Plugin

# Tools and the provider are discovered from the manifest
# (provider/nobulex.yaml -> tools/*.yaml -> each `extra.python.source`).
plugin = Plugin(DifyPluginEnv(MAX_REQUEST_TIMEOUT=120))

if __name__ == "__main__":
    plugin.run()
