# Builder image for WinacuxOS live ISO builds.
# live-build must run as root inside a Linux container; this image carries
# every tool live-build shells out to.
FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        live-build \
        debootstrap \
        xorriso \
        rsync \
        dosfstools \
        squashfs-tools \
        mtools \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

CMD ["/bin/bash"]