use serde::{Deserialize, Serialize};
use std::process::Command;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RendererBackend {
    Webgl2,
    Webgpu,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecodeBackend {
    Htmlvideo,
    Webcodecs,
    NativeFfmpeg,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub webgl2: bool,
    pub webgpu: bool,
    pub webcodecs: bool,
    pub native_ffmpeg: bool,
    pub rust_ffmpeg_feature: bool,
    pub selected_renderer: RendererBackend,
    pub selected_decode: DecodeBackend,
}

#[derive(Debug, Error)]
pub enum MediaRuntimeError {
    #[error("webgpu is not available on this runtime")]
    WebGpuUnavailable,
    #[error("native ffmpeg is not available in PATH")]
    NativeFfmpegUnavailable,
    #[error("webcodecs acceleration is not available on this runtime")]
    WebCodecsUnavailable,
}

#[derive(Debug, Clone)]
pub struct MediaRuntime {
    capabilities: RuntimeCapabilities,
}

impl Default for MediaRuntime {
    fn default() -> Self {
        Self {
            capabilities: detect_capabilities(),
        }
    }
}

impl MediaRuntime {
    pub fn refresh_capabilities(&mut self) -> RuntimeCapabilities {
        let selected_renderer = self.capabilities.selected_renderer.clone();
        let selected_decode = self.capabilities.selected_decode.clone();

        let mut updated = detect_capabilities();
        updated.selected_renderer = selected_renderer;
        updated.selected_decode = selected_decode;

        if updated.selected_renderer == RendererBackend::Webgpu && !updated.webgpu {
            updated.selected_renderer = RendererBackend::Webgl2;
        }

        if updated.selected_decode == DecodeBackend::NativeFfmpeg && !updated.native_ffmpeg {
            updated.selected_decode = DecodeBackend::Htmlvideo;
        }

        if updated.selected_decode == DecodeBackend::Webcodecs && !updated.webcodecs {
            updated.selected_decode = DecodeBackend::Htmlvideo;
        }

        self.capabilities = updated;
        self.capabilities.clone()
    }

    pub fn set_renderer(&mut self, backend: RendererBackend) -> Result<RuntimeCapabilities, MediaRuntimeError> {
        if backend == RendererBackend::Webgpu && !self.capabilities.webgpu {
            return Err(MediaRuntimeError::WebGpuUnavailable);
        }

        self.capabilities.selected_renderer = backend;
        Ok(self.capabilities.clone())
    }

    pub fn set_decode(&mut self, backend: DecodeBackend) -> Result<RuntimeCapabilities, MediaRuntimeError> {
        match backend {
            DecodeBackend::NativeFfmpeg if !self.capabilities.native_ffmpeg => {
                Err(MediaRuntimeError::NativeFfmpegUnavailable)
            }
            DecodeBackend::Webcodecs if !self.capabilities.webcodecs => Err(MediaRuntimeError::WebCodecsUnavailable),
            _ => {
                self.capabilities.selected_decode = backend;
                Ok(self.capabilities.clone())
            }
        }
    }
}

pub fn detect_capabilities() -> RuntimeCapabilities {
    RuntimeCapabilities {
        webgl2: true,
        webgpu: false,
        webcodecs: false,
        native_ffmpeg: probe_native_ffmpeg(),
        rust_ffmpeg_feature: cfg!(feature = "native-ffmpeg"),
        selected_renderer: RendererBackend::Webgl2,
        selected_decode: DecodeBackend::Htmlvideo,
    }
}

pub fn probe_native_ffmpeg() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_has_default_webgl2() {
        let caps = detect_capabilities();
        assert!(caps.webgl2);
        assert_eq!(caps.selected_renderer, RendererBackend::Webgl2);
    }

    #[test]
    fn set_decode_rejects_unavailable_native_ffmpeg() {
        let mut runtime = MediaRuntime {
            capabilities: RuntimeCapabilities {
                webgl2: true,
                webgpu: false,
                webcodecs: false,
                native_ffmpeg: false,
                rust_ffmpeg_feature: false,
                selected_renderer: RendererBackend::Webgl2,
                selected_decode: DecodeBackend::Htmlvideo,
            },
        };

        let result = runtime.set_decode(DecodeBackend::NativeFfmpeg);
        assert!(matches!(result, Err(MediaRuntimeError::NativeFfmpegUnavailable)));
    }
}
