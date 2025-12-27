+++
title = '3pp'
publishedDate = 2025-12-25T18:32:23+07:00
draft = false
repo = 'https://github.com/nibtr/3pp'
demo = 'https://nibtr.github.io/3pp'
description = 'A simple demo of 3d perspective projection'
+++

3pp - 3d perspective projection, is an example demo of rendering 3d models onto a 2d plane using perspective projection.
The project is only for educational purposes only and is not meant for anything serious.

![penger](../../assets/projects/3pp/penger.png)

## Algorithm

It is derived from this formula:

```md
Given a point (x, y, z) in 3d space, the 2d point on the screen is given by:

x' = xf / z
y' = yf / z

where f is the distance between the image plane and the center of projection.
```

## Features

- Scroll to zoom in/out
- Drag to rotate the model

## Run

You can run the demo by cloning the repo and install `serve` to run it locally.

```sh
npm install -g serve
git clone https://github.com/nibtr/3pp
cd 3pp
serve .
```

or visit the [demo](https://nibtr.github.io/3pp).

## References

The demo is mostly referenced from this [video](https://www.youtube.com/watch?v=qjWkNZ0SXfo) by Tsoding. He explains
the algorithm pretty clearly.

I also did some additional read on:

- https://www.cse.unr.edu/~bebis/CS791E/Notes/PerspectiveProjection.pdf
- https://en.wikipedia.org/wiki/Rotation_matrix

## License

MIT
