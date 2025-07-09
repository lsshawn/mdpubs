#!/bin/bash

cd /home/ss/projects/mdpubs-ui/
pnpm run dev &

cd /home/ss/projects/mdpubs-api/
bun dev &

wait
