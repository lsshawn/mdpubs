#!/bin/bash

cd /home/ss/projects/neonote/
pnpm run dev &

cd /home/ss/projects/neonote-api/
bun dev &

wait
