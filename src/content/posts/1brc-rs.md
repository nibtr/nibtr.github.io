+++
title = '1 Billion Row Challenge in Rust: How I went from 160s to 2.4s'
date = 2026-01-20T20:13:01+07:00
draft = false
+++

A while back I was looking for something to work on while learning Rust and I
came across the [1 Billion Row
Challenge](https://github.com/gunnarmorling/1brc). It's a fun little
optimization challenge that I thought would be a good exercise to get
some more experience with Rust, as well as to learn more about low level
programming.

Started from the humble **160s** of execution time, I was able to bring it
down to **2.4s**, which is roughly a **66.7x** speedup! But hey the numbers only
tell part of the story, the real treasure is the learning and debugging
done along the way.

This article is a summary of the 12 optimizations I wrote in Rust, each is an
improvement on the previous one. We'll start off with a simple and naive
optimization and work our way up gradually to more complex ones.

Here's the rundown:

1. [naive and simple](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v1.rs)
2. [using a hashmap initialized with capacity](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v2.rs)
3. [lazy string allocation in hashmap keys](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v3.rs)
4. [using `Vec<u8>` instead of `String` for keys + unchecked UTF-8
   parsing](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v4.rs)
5. [parse temperatures as integers](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v5.rs)
6. [better hashing: using fnv1a](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v6.rs)
7. [mmap](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v7.rs)
8. [memchr](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v8.rs)
9. [unroll temperature parsing](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v9.rs)
10. [better hashing, use vec and manual collision detection instead of HashMap](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v10.rs)
11. [multithreading](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v11.rs)
12. [inline name + some better optimizations](https://github.com/nibtr/1brc-rs/blob/main/src/bin/v12.rs)

I will be using a lot of `unwrap()` and `expect()` for simplicity, and 
also unsafe code to get even more speed, but I will make sure to explain
why it's necessary and how the constraints of the challenge allow us to do so.

*Disclaimer:* I am by no means an expert in Rust, so I might have made
mistakes in the code. The quality of the code is as bad as it can be and
is not portable across platforms except for unix-like systems.
Nonetheless, I hope it's still useful to someone.

If you just want to see the results, skip to the [benchmarks](#appendix-benchmarks).

## The challenge

The 1 billion row challenge is very simple: given a text file of 1
billion rows, each row has a structure of `city;temperature`:

```csv
Hamburg;12.0
Bulawayo;8.9
Palembang;38.8
St. John's;15.2
Cracow;12.6
```

The program should print out the **min, mean, and max** values per station,
alphabetically ordered like so:

```text
{Abha=5.0/18.0/27.4, Abidjan=15.7/26.0/34.1, Abéché=12.1/29.4/35.6, Accra=14.7/26.4/33.1, Addis Ababa=2.1/16.0/24.3, Adelaide=4.1/17.3/29.7, ...}
```

The goal is to write a program that runs as fast as possible, with some
constraints:

- No external dependencies
- Input value ranges are as follows:
  - Station name: non null UTF-8 string of min length 1 character and
  max length 100 bytes (i.e. this could be 100 one-byte characters, or
  50 two-byte characters, etc.).
  - Temperature value: non null double between -99.9 (inclusive) and
  99.9 (inclusive), always with one fractional digit.
- There is a maximum of 10,000 unique station names.

## System specs & Measurements

All measurements are done on a machine with the following specs:

- OS: Linux x86_64 - 6.12 kernel
- CPU: AMD Ryzen 5 7600 (12 cores) measured at ~4.5-4.7 GHz
- RAM: 32 GB DDR5
- Storage: A pretty fast SSD

Execution times are in seconds and are measured with `time` utility,
with speedup being the ratio to the naive optimization.

## Profiling, then optimizing

When you need to optimize something, and don't know where to start, profiling
should be your first step.

On Linux, `perf` is one of the best tools to use, has many features and
is straight out of the box. I will be using it to analyze the stats of
the whole program, giving me insights into low-level CPU counters.

```bash
# analyze the stats
perf stat -e branches,branch-misses,cache-references,cache-misses,cycles,instructions,idle-cycles-backend,idle-cycles-frontend,task-clock -- <program>
```

Do note that this is also my first time using `perf`, so there are
things that I don't fully understand yet. But most of the time, it's
pretty straightforward.

## Optimization 0: build configuration

The optimizations will be compiled in release mode, with the following
configuration:

```toml
[profile.release]
codegen-units = 1
lto = "fat"
panic = "abort"
debug = true
```

Here's a great [reference](https://nnethercote.github.io/perf-book/build-configuration.html)
on the different options.

## Optimization 1: naive, idiomatic Rust

As with any iterative process, the first thing I did was to write a very
simple solution to make sure that I manage to get the results correctly.

I will be using a `BufReader` to read the input file line by line, split
the row at `;` and parse the temperature value as a `f64`. Then use
a `BTreeMap` to store the min, max, and mean values per station name,
the keys are automatically sorted alphabetically.

```rust
let f = File::open("data/measurements.txt").expect("file should exist");
let f = BufReader::new(f);

// (min, max, sum, count)
let mut stats: BTreeMap<String, (f64, f64, f64, usize)> = BTreeMap::new();

for line in f.lines().map_while(Result::ok) {
    let (station, temperature) = line.split_once(";").expect("delimiter should be ;");
    let temperature = temperature
        .parse::<f64>()
        .expect("should be a valid floating point");

    let stats = stats
        .entry(station.to_string())
        .or_insert((f64::MAX, f64::MIN, 0.0, 0));

    stats.0 = stats.0.min(temperature);
    stats.1 = stats.1.max(temperature);
    stats.2 += temperature;
    stats.3 += 1;
}

let mut stats = stats.into_iter().peekable();

print!("{{");
while let Some((station, (min, max, sum, count))) = stats.next() {
    print!("{station}={min}/{:.1}/{max}", sum / (count as f64));
    if stats.peek().is_some() {
        print!(", ");
    }
}
print!("}}")
```

It is as straightforward as it gets, but as you might have guessed, it's not very
efficient. This solution takes around **160s** to finish.

## Optimization 2: using a HashMap initialized with capacity

Although `BTreeMap` helps with sorting the keys, it's not efficient when
you have to insert a lot of elements in a hot loop since it has to
rebalance the tree every time. Well, we could use a `HashMap` for this. A
hash map is similar to a b-tree map but it doesn't have to sort
anything while inserting so we can gain more performance. 

`HashMap` under the hood uses a `Vec`, so to reduce the number of times on
reallocation and copying, I also initialized the HashMap with a capacity of 10_000,
which is the maximum number of entries we expect to have.

Then at the end of the program, I converted the `HashMap` back to a `BTreeMap`
and print the results. This won't affect the performance that much because
now we will only have 10_000 unique entries to deal with and only have
to sort them once.

All this is just a simple change to the code:

```rust
// (min, max, sum, count)
let mut stats: HashMap<String, (f64, f64, f64, usize)> = HashMap::with_capacity(10_000);

// ... same code as before

// convert to BTreeMap to sort the keys
let stats = BTreeMap::from_iter(stats);
let mut stats = stats.into_iter().peekable();

print!("{{");
while let Some((station, (min, max, sum, count))) = stats.next() {
    print!("{station}={min}/{:.1}/{max}", sum / (count as f64));
    if stats.peek().is_some() {
        print!(", ");
    }
}
print!("}}")
```

Just by changing the data structure I'm now down to `~85s`, which is a
`~1.87x` speedup from the naive optimization. Not bad, right?

## Optimization 3: lazy string allocation in HashMap keys

Looking at this line:

```rust
let stats = stats
    .entry(station.to_string())
    .or_insert((f64::MAX, f64::MIN, 0.0, 0));
```

We are doing memory allocation with `station.to_string()` every time we
need to check for the keys (for insertion AND for lookup). This is
wasteful because for lookup, we can actually compare the
`String` and `&str` directly. This will save us a lot of unnecessary
allocations.

```rust
// station is a &str
let (station, temperature) = line.split_once(";").expect("delimiter should be ;");
// ...
let stats = match stats.get_mut(station) {
        Some(stats) => stats,
        None => stats
            .entry(station.to_string())
            .or_insert((f64::MAX, f64::MIN, 0.0, 0)),
    };
```

When splitting the row by `;`, the `station` we get back is already a `&str`.
We can just use it directly for key lookup, and only allocate a new `String`
for the key when we need to insert a new value.

This change saved me `~12s` and brought the total time down to `~73s`,
with a `~2.18x` speedup.

## Optimization 4: using `Vec<u8>` instead of `String` for keys + unchecked UTF-8 parsing

One of the constraints confirms that all input values are valid UTF-8,
this allows us to bypass some of the checks when parsing because we know
the data is guaranteed to be valid UTF-8.

Also, since we don't plan on using any `String` APIs, we can just store
the station names as `Vec<u8>` instead to avoid unnecessary overheads.
Luckily for us, Rust allows `Vec<u8>` to be used directly as a `HashMap`
key since it already implements the required traits: `Eq` and `Hash`.

Let's do them one by one:

```rust
// change the keys to Vec<u8>
let mut stats: HashMap<Vec<u8>, (f64, f64, f64, usize)> = HashMap::with_capacity(10_000);

// now when looping over the rows, we can split by `\n` instead
for line in f.split(b'\n').map_while(Result::ok) {
    let mut fields = line.splitn(2, |c| *c == b';');
    let station = fields.next().unwrap();
    let temperature = fields.next().unwrap();
    let temperature: f64 = unsafe { std::str::from_utf8_unchecked(temperature) }
      .parse()
      .unwrap();

    let stats = match stats.get_mut(station) {
      Some(stats) => stats,
      None => stats
          .entry(station.to_vec())
          .or_insert((f64::MAX, f64::MIN, 0.0, 0)),
    };
// ...
}
let stats = BTreeMap::from_iter(
    stats
        .into_iter()
        .map(|(station, stats)| (unsafe { String::from_utf8_unchecked(station) }, stats)),
);
// ...
```

Ooh, `unsafe`! But don't worry, it's totally fine here because we know
the temperature we're parsing is guaranteed to be valid UTF-8, the same
goes for station names. So `std::str::from_utf8_unchecked` and
`String::from_utf8_unchecked` are actually safe to use and are much faster.
We still need to do `station.to_vec()` to get a `Vec<u8>` though.

Now it's down to `~59s` with a `~2.7x` speedup.

## Optimization 5: Parse temperatures as integers

Here's a really neat trick I learned: you can actually parse the
temperatures as integers and only when printing do we need to parse them
as floats.

Parsing and aggregating temperatures as integers avoids floating-point
parsing, floating-point arithmetic, and rounding until the very end.
This keeps the hot loop entirely in integer arithmetic, which reduces
instruction count and register pressure, and as a result, saves us some
CPU cycles.

```rust
// (min, max, sum, count)
let mut stats: HashMap<Vec<u8>, (i32, i32, i32, usize)> = HashMap::with_capacity(10_000);
//...
for line in f.split(b'\n').map_while(Result::ok) {
    let mut fields = line.splitn(2, |c| *c == b';');
    let station = fields.next().unwrap();
    let temperature = fields.next().unwrap();
    let temperature = parse_temperature(temperature);
// ...
}

print!("{{");
while let Some((station, (min, max, sum, count))) = stats.next() {
    print!(
        "{station}={:.1}/{:.1}/{:.1}",
        min as f64 / 10.0,
        sum as f64 / 10.0 / count as f64,
        max as f64 / 10.0
    );
    if stats.peek().is_some() {
        print!(", ");
    }
}
print!("}}")

// ...

fn parse_temperature(t: &[u8]) -> i32 {
    let mut signed = 1;
    let mut n = 0;
    for &b in t {
        match b {
            b'-' => signed = -1,
            b'.' => {}
            _ => n = n * 10 + (b - b'0') as i32,
        }
    }
    signed * n
}
```

The idea is very simple: we loop the bytes of the temperature, check for
different cases and update the `n` variable accordingly. Then we return the
result. E.g. if the temperature is `-12.3`, we will get `-123`. Then
when printing, we can divide the value by 10 to get the actual float.

Now it's down to `~55s`, that saves us around `4s`. Not much but it's
still a win. Looking at the `perf` stats:

```text
# Before optimization

155,022,922,709      branches:u                       #    2.650 G/sec                       (85.71%)
  2,914,220,481      branch-misses:u                  #    1.88% of all branches             (85.71%)
  4,909,470,169      cache-references:u               #   83.934 M/sec                       (85.72%)
    777,445,559      cache-misses:u                   #   15.84% of all cache refs           (85.71%)
287,486,850,000      cycles:u                         #    4.915 GHz                         (85.71%)
836,204,231,606      instructions:u                   #    2.91  insn per cycle

# After optimization

144,474,015,086      branches:u                       #    2.639 G/sec                       (85.72%)
  2,746,280,655      branch-misses:u                  #    1.90% of all branches             (85.71%)
  4,352,618,794      cache-references:u               #   79.511 M/sec                       (85.72%)
    555,749,482      cache-misses:u                   #   12.77% of all cache refs           (85.71%)
268,545,581,519      cycles:u                         #    4.906 GHz                         (85.72%)
768,534,700,580      instructions:u                   #    2.86  insn per cycle
```

You can see that there are **~7%** fewer cycles and **~8%** fewer instructions,
pretty good!.

## Optimization 6: Better hashing: using FNV-1a

The [Rust doc](https://doc.rust-lang.org/std/collections/struct.HashMap.html)
for `HashMap` says:

> By default, HashMap uses a hashing algorithm selected to provide
resistance against HashDoS attacks...
The default hashing algorithm is currently SipHash 1-3, though this is
subject to change at any point in the future. While its performance is
very competitive for medium sized keys, other hashing algorithms will
outperform it for small keys such as integers as well as large keys such
as long strings, though those algorithms will typically not protect
against attacks such as HashDoS.

**TL;DR**: The default algorithm is still fast, but it needs to do more work
for security reasons. For this challenge, security is not really a concern,
so opting for other non-cryptographic algorithms is fine. I then opted for
[FNV-1a](https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function#FNV-1a_hash),
which is an algorithm that I can technically implement myself. I can go
for `ahash` or `xxhash` crates, but that is against the rule of not
using external dependencies.

First I need to actually build the hasher:

```rust
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

struct Fnv1aHasher {
    hash: u64,
}

impl Default for Fnv1aHasher {
    fn default() -> Self {
        Self {
            hash: FNV_OFFSET_BASIS,
        }
    }
}

impl Hasher for Fnv1aHasher {
    #[inline(always)]
    fn finish(&self) -> u64 {
        self.hash
    }

    #[inline(always)]
    fn write(&mut self, bytes: &[u8]) {
        let mut h = self.hash;
        for &b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(FNV_PRIME);
        }
        self.hash = h;
    }
}

struct Fnv1aHashBuilder;
impl BuildHasher for Fnv1aHashBuilder {
    type Hasher = Fnv1aHasher;

    fn build_hasher(&self) -> Self::Hasher {
        Fnv1aHasher::default()
    }
}
```

then use it like so, with everything else should be the same:

```rust
let mut stats: HashMap<Vec<u8>, (i32, i32, i32, usize), Fnv1aHashBuilder> =
    HashMap::with_capacity_and_hasher(10_000, Fnv1aHashBuilder);
```

The new hasher gets me down from `~55s` to `~51s`. The improvement is
small, but for a simple hash algorithm like FNV-1a, that's good enough.
The fact that it's so easy to implement is already a win for me :).

## Optimization 7: mmap

Now we're getting into the fun part.

[mmap](https://en.wikipedia.org/wiki/Mmap) is a new concept for me at
the time of doing the challenge, and since everyone went for this
approach, I decided to try it out.

Basically, `mmap` lets the operating system map the file directly into
the virtual memory space so I can treat it like a large byte array in
memory. It also avoids the cost of extra copies from the kernel to an
in-memory buffer and instead accesses the kernel's page cache directly.
In a hot loop like what we're doing, this can be a huge performance boost.

In Rust, `memmap2` is a crate that provides APIs to use `mmap`.
But since I'm not allowed to use any external dependencies, I had to
manually re-implemented a small part of the crate (this is fine right? :D).

```rust
unsafe fn mmap(f: File) -> Result<&'static [u8], io::Error> {
    let len = f.metadata()?.len();

    unsafe {
        let ptr = libc::mmap(
            std::ptr::null_mut(),
            len as libc::size_t,
            libc::PROT_READ,
            libc::MAP_PRIVATE,
            f.as_raw_fd(),
            0,
        );

        if ptr == libc::MAP_FAILED {
            Err(io::Error::last_os_error())
        } else {
            if libc::madvise(ptr, len as libc::size_t, libc::MADV_SEQUENTIAL) != 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(std::slice::from_raw_parts(ptr as *const u8, len as usize))
            }
        }
    }
}
```

`libc` is an external crate, but it’s effectively unavoidable for
low-level syscalls, and `std` itself depends on it internally.

`libc::mmap()` is inherently unsafe, but that's not a problem here because the
file is read-only, never mutated, and mapped for the entire duration of
the program. Furthermore, because we're reading the file sequentially, with
`madvise(MADV_SEQUENTIAL)`, we can also explicitly hint to the kernel
that the access pattern is sequential, further improving the performance by
fetching more data from the disk. I know I should have used `libc::munmap()` to
unmap the file, but I wanted to keep the code as simple as possible.

Now we just need to use it like so:

```rust
let f = File::open("data/measurements.txt").expect("file should exist");
let f = unsafe { mmap(f).unwrap() };
// ...
```

and change how we split the `\n`:

```rust
for line in f.split(|c| *c == b'\n') {
    // this is needed for case we're at the end of the file
    if line.is_empty() {
        continue;
    }
    // ...
}
```

The new `mmap` approach brought the total time down to `~33.5s` with a
`~4.76x` speedup from the very first optimization. That's a huge win!

## Optimization 8: memchr

Using `libc::mmap()` gives us essentially “parallel I/O” because the kernel
handles read-ahead automatically. On top of that, we can speed up parsing
by using `libc::memchr()` to find `\n` and `;` instead of doing a `.split()` on the slice.
Under the hood, `libc::memchr()` is highly optimized at the CPU level,
utilizing [SIMD](https://en.wikipedia.org/wiki/Single_instruction,_multiple_data)
when possible and scans memory much faster than a typical Rust iterator or string split.

I still don't understand much about SIMD, but the key idea is that the CPU can process multiple
bytes at once instead of one at a time.

With `memchr`, because it returns a pointer to the first occurrence of
the byte we want, we need to adjust how we handle the loop logic:

```rust
let mut at = 0;
loop {
    let rest = &map[at..];
    let nl_ptr = unsafe {
        libc::memchr(
            rest.as_ptr() as *const libc::c_void,
            b'\n' as libc::c_int,
            rest.len(),
        )
    };

    let line = if nl_ptr.is_null() {
        rest
    } else {
        /// SAFETY: same contiguous memory as `rest`
        let len = unsafe { (nl_ptr as *const u8).offset_from(rest.as_ptr()) } as usize;
        &rest[..len]
    };

    at += line.len() + 1;

    if line.is_empty() {
        break;
    }

    let semicolon_ptr = unsafe {
        libc::memchr(
            line.as_ptr() as *const libc::c_void,
            b';' as libc::c_int,
            line.len(),
        )
    };
    let semicolon_pos = if semicolon_ptr.is_null() {
        continue; // skip malformed lines
    } else {
        unsafe { (semicolon_ptr as *const u8).offset_from(line.as_ptr()) as usize }
    };

    let station = &line[..semicolon_pos];
    let temperature = &line[(semicolon_pos + 1)..];
    let temperature = parse_temperature(temperature);

    let stats = match stats.get_mut(station) {
        Some(stats) => stats,
        None => stats
            .entry(station.to_vec())
            .or_insert((i32::MAX, i32::MIN, 0, 0)),
    };

    stats.0 = stats.0.min(temperature);
    stats.1 = stats.1.max(temperature);
    stats.2 += temperature;
    stats.3 += 1;
}

// ...
```

We use unsafe here because `libc::memchr` and pointer arithmetic can’t
be checked by Rust, but it’s safe in our code because:
- `mmap` slice covers the entire file, so pointers are valid.
- We never write to memory, only read.
- All pointer arithmetic stays within bounds.
- The scan is strictly forward, so no underflow or dangling pointers.

We're now at `~25.4s` with a `~6.3x` speedup from the naive
optimization.

## Optimization 9: Unroll temperature parsing

Currently, I'm doing a loop when parsing the temperature:

```rust
fn parse_temperature(t: &[u8]) -> i32 {
    // rule states that file is valid floating point with 1 decimal place
    let mut signed = 1;
    let mut n = 0;
    for &b in t {
        match b {
            b'-' => signed = -1,
            b'.' => {}
            _ => n = n * 10 + (b - b'0') as i32,
        }
    }
    signed * n
}
```

But since the constraint guarantees the floating value to
have the format `[-]DD.D` or `[-]D.D`, with 1 decimal place, we can
actually ignore (unroll) the loop entirely and just do manual
increments:

```rust
#[inline(always)]
fn parse_temperature(t: &[u8]) -> i32 {
    let mut neg = 1;
    let mut i = 0;
    if t[i] == b'-' {
        i += 1;
        neg = -1;
    }

    let mut n = (t[i] - b'0') as i32;
    i += 1;

    if t[i] != b'.' {
        n = n * 10 + (t[i] - b'0') as i32;
        i += 1;
    }

    i += 1; // skip .
    n = n * 10 + (t[i] - b'0') as i32;
    neg * n
}
```

By not having a loop, the CPU no longer has to deal with a data-dependent
iteration. Instead, it can follow a mostly fixed control flow with just
a couple of easy-to-predict branches. This turns the parser into a short,
straight-line path, reduces branch mispredictions, and gives a nice
performance boost on the hot path. You can read more about [Branch Predictor](https://en.wikipedia.org/wiki/Branch_predictor)
and [Loop Unrolling](https://en.wikipedia.org/wiki/Loop_unrolling) on
Wikipedia to learn more about these optimizations.

With this change, we're now down to `~23.4s` with a `~6.8x` speedup,
small improvement but still worth it. Looking at `perf stat` now:

```text
# Before optimization

 57,101,159,322      branches:u                       #    2.276 G/sec                       (85.71%)
  1,693,650,023      branch-misses:u                  #    2.97% of all branches             (85.71%)
  4,350,512,328      cache-references:u               #  173.410 M/sec                       (85.72%)
    485,971,823      cache-misses:u                   #   11.17% of all cache refs           (85.71%)
123,490,782,212      cycles:u                         #    4.922 GHz                         (85.71%)
299,589,936,934      instructions:u                   #    2.43  insn per cycle
                                              #    0.06  stalled cycles per insn     (85.72%)

# After optimization

 43,501,493,817      branches:u                       #    1.882 G/sec                       (85.71%)
  1,180,527,032      branch-misses:u                  #    2.71% of all branches             (85.71%)
  4,927,317,991      cache-references:u               #  213.143 M/sec                       (85.72%)
    591,556,496      cache-misses:u                   #   12.01% of all cache refs           (85.71%)
113,411,564,919      cycles:u                         #    4.906 GHz                         (85.71%)
287,745,770,431      instructions:u                   #    2.54  insn per cycle
                                              #    0.04  stalled cycles per insn     (85.72%)
```

We can see that we have less branches to process, also the branch misses
dropped a little bit, as well as the total cycles and instructions.
This proves that the new optimization works as expected.

## Optimization 10: Better hashing, use Vec and manual collision detection instead of HashMap

At this point, I was fairly happy with the results (and also a bit stuck :D).
To gain better insights, I took a look at the [top Java solution](https://github.com/gunnarmorling/1brc/blob/main/src/main/java/dev/morling/onebrc/CalculateAverage_thomaswue.java)
by *thomaswue* and see what are their approach. 

After some digging, what I understood was:

- He uses a fixed-size raw array as a custom open-addressed hash table,
with manual collision handling.
- During collision resolution, he first compares the first 16 bytes of
the key and only falls back to a full key comparison if needed.
- Each entry is stored as a struct containing a pointer-like value
(likely an offset into the mmap’d byte slice) along with the name length,
allowing the original key to be reconstructed via slicing (offset + length).

This has a few advantages:
- A raw array has significantly less overhead than a general-purpose `HashMap`.
- Comparing the first 16 bytes fits into a couple of CPU registers and
avoids a full byte-by-byte comparison in the common case.
- There are no allocations, no copying, and no UTF-8 validation - the key
already lives in the mmap’d file and is simply referenced.

What surprised me the most was how effective the partial key comparison is.
Like any other programmer, I ~~copied and pas~~ tried to implement it myself.

First let's introduce a table size and change how we store the entries
and how we print the results:

```rust
// 2^17 is ~130k entries, good enough for collision resolution
const HASH_TABLE_SIZE: usize = 1 << 17;

#[derive(Copy, Clone)]
struct Entry {
    w0: usize,
    w1: usize,
    name_len: usize,
    name_offset: usize, // offset relative to full mmap
    min: i32,
    max: i32,
    sum: i32,
    count: usize,
}

let mut entries: Vec<Option<Entry>> = vec![None; HASH_TABLE_SIZE];
// ...

let mut at = 0;
while at < map.len() {
    // ..
    // We will implement this
    insert_or_update(&mut entries, station, temperature, map);
}

// printing
let mut results: Vec<_> = entries.into_iter().flatten().collect();
results.sort_by_key(|e| {
    let name = &map[e.name_offset..(e.name_offset + e.name_len)];
    name.to_vec()
});

print!("{{");
for (i, entry) in results.iter().enumerate() {
    let name_bytes = &map[entry.name_offset..entry.name_offset + entry.name_len];
    let name = unsafe { std::str::from_utf8_unchecked(name_bytes) };
    print!(
        "{name}={:.1}/{:.1}/{:.1}",
        entry.min as f64 / 10.0,
        entry.sum as f64 / 10.0 / entry.count as f64,
        entry.max as f64 / 10.0
    );
    if i + 1 != results.len() {
        print!(", ");
    }
}
println!("}}");
```

Now we implement the main logic. First we'll need a function to hash the
bytes to the index in the table:

```rust
// cred: https://github.com/thomaswue
#[inline(always)]
fn hash_to_idx(word_0: usize, word_1: usize, table_size: usize) -> usize {
    let mut hash = word_0 ^ word_1;
    hash ^= (hash >> 33) ^ (hash >> 15);
    hash & (table_size - 1)
}
```

The core of the optimization lives in `insert_or_update`:

```rust
// cred: https://github.com/thomaswue
fn insert_or_update(entries: &mut [Option<Entry>], station: &[u8], temperature: i32, map: &[u8]) {
    let mut w0: usize = 0;
    let mut w1: usize = 0;

    for i in 0..station.len().min(8) {
        w0 |= (station[i] as usize) << (i * 8);
    }
    for i in 0..station.len().saturating_sub(8).min(8) {
        w1 |= (station[i + 8] as usize) << (i * 8);
    }

    let mut idx = hash_to_idx(w0, w1, entries.len());
    let step = 31; // works if table size is a power of 2
    let mask = entries.len() - 1;

    loop {
        match &mut entries[idx] {
            // empty slot -> insert
            None => {
                entries[idx] = Some(Entry {
                    w0,
                    w1,
                    min: temperature,
                    max: temperature,
                    sum: temperature,
                    count: 1,
                    name_len: station.len(),
                    name_offset: unsafe { station.as_ptr().offset_from(map.as_ptr()) } as usize,
                });
                return;
            }
            Some(e) => {
                // fast reject if collision
                if e.w0 != w0 || e.w1 != w1 {
                    idx = (idx + step) & mask;
                    continue;
                }

                if e.name_len as usize != station.len() {
                    idx = (idx + step) & mask;
                    continue;
                }

                // slow path if collision: compare full slice
                let existing =
                    unsafe { map.get_unchecked(e.name_offset..e.name_offset + e.name_len) };
                if existing != station {
                    idx = (idx + step) & mask;
                    continue;
                }

                // exist, update entry
                e.min = e.min.min(temperature);
                e.max = e.max.max(temperature);
                e.sum += temperature;
                e.count += 1;

                return;
            }
        }
    }
}
```

This snippet right here is a bit of wizardry:

```rust
for i in 0..station.len().min(8) {
    w0 |= (station[i] as usize) << (i * 8);
}
for i in 0..station.len().saturating_sub(8).min(8) {
    w1 |= (station[i + 8] as usize) << (i * 8);
}
```

Essentially, instead of comparing station names byte by byte, the code
packs the first 16 bytes of the name into two usize values:

- w0 holds bytes 0..8
- w1 holds bytes 8..16

Each byte is shifted into position and OR’d into the final value,
effectively creating a compact, fixed-size representation of the key
prefix. Most comparisons are resolved by checking just these two integers.
There is a better way to do this (using bit mask), which I’ll cover
later.

With this change alone, the total runtime dropped to `~21s` with a total
speedup of `~7.5x`. Not bad at all.

## Optimization 11: Multi-threading

Of course!

The idea is simple: we can split the mmap byte slice into multiple
chunks (number of threads), and each thread will process its own chunk.
Then at the end we can merge the results. The problem is that we need to 
make sure that the chunks are correctly split so we don't miss any data.
We can do this by first just splitting the slice into chunks, then make
sure that each chunk up to the last one ends on a newline character. The
last chunk can just be the rest of the slice.

```rust
fn chunk_file(map: &[u8], n_workers: usize) -> Vec<(usize, usize)> {
    let mut chunks = Vec::with_capacity(n_workers);
    let file_len = map.len();
    let base = file_len / n_workers;
    let mut start: usize = 0;

    for _ in 0..n_workers - 1 {
        let mut end = start + base;
        if end >= file_len {
            break;
        }

        while end < file_len && map[end] != b'\n' {
            end += 1;
        }

        chunks.push((start, end));
        start = end + 1;
    }

    chunks.push((start, file_len));
    chunks
}
```

Then use it and push each chunk into a thread, and join them all at the
end, accumulating the results:

```rust
let n_workers = thread::available_parallelism()
    .map(|n| n.get())
    .unwrap_or(1);
let chunks = chunk_file(map, n_workers);
let mut handles = Vec::with_capacity(n_workers);
let mut results: Vec<Vec<Option<Entry>>> = vec![Vec::new(); n_workers];

for (idx, (start, end)) in chunks.into_iter().enumerate() {
    handles.push(thread::spawn(move || {
        (idx, thread_process_chunk(&map[start..end], map))
    }));
}

for handle in handles {
    let (idx, entries) = handle.join().expect("should be able to join");
    results[idx] = entries;
}
```

The main logic can stay the same, just need to adjust how we handle the
chunk. There is also a important very change we also need to make: when saving the
`name_offset`, we need to make sure that it is relative to the start of
full the mmap slice, not the current chunk. The reason is that when
merging the results, we need to be able to reconstruct the full name
from the original mmap slice, not from a chunk-local view.

This makes the merge phase much simpler and safer, since all intermediate
results now speak the same “coordinate system” when referring to station names.

```rust
fn thread_process_chunk(chunk: &[u8], map: &[u8]) -> Vec<Option<Entry>> {
    let mut entries: Vec<Option<Entry>> = vec![None; HASH_TABLE_SIZE];

    let mut at = 0;
    while at < chunk.len() {
        let rest = &chunk[at..];
        // ..
    }
}

fn thread_insert_or_update(
    entries: &mut [Option<Entry>],
    station: &[u8],
    temperature: i32,
    map: &[u8], // full mmap for offset calculations
) {
    // ...
    loop {
        match &mut entries[idx] {
            // empty slot -> insert
            None => {
                entries[idx] = Some(Entry {
                    w0,
                    w1,
                    min: temperature,
                    max: temperature,
                    sum: temperature,
                    count: 1,
                    name_len: station.len(),
                    // need to make sure that the offset is relative to the full mmap
                    name_offset: unsafe { station.as_ptr().offset_from(map.as_ptr()) } as usize,
                });
                return;
            }
            Some(e) => {
                // ...
            }
        }
    }
}
```

Then we merge the results:

```rust
let mut final_map: BTreeMap<&[u8], Entry> = BTreeMap::new();
for thread_entries_result in &results {
    for &entry in thread_entries_result.iter().flatten() {
        // here we reconstruct the full name from the original mmap slice
        let name_bytes = &map[entry.name_offset..entry.name_offset + entry.name_len];

        if let Some(existing) = final_map.get_mut(name_bytes) {
            existing.min = existing.min.min(entry.min);
            existing.max = existing.max.max(entry.max);
            existing.sum += entry.sum;
            existing.count += entry.count;
        } else {
            final_map.insert(name_bytes, entry);
        }
    }
}
```

Doing multi-threading optimization, utilizing all 12 available cores on
my machine, the total runtime dropped to `~3.5s` with a total speedup of `~45.54x`.
Massive win!

## Optimization 12: inline station name + better temperature parse + faster first 16 bytes load for name

This already ran in about 3.5 seconds with multi-threading, which was a
huge win, and honestly I was ready to stop there. But curiosity got the
better of me, I wanted to see how much further I could push it.

While digging around, I came across a pretty neat trick used by jonhoo
in his [brrr](https://github.com/jonhoo/brrr) solution: inline short
station names directly into the entry struct.

At this point in my code, every time I needed to access a station name, I had to:
- Follow a pointer (or offset) into the mmap slice.
- Slice out the name using offset + length

That indirection isn't free. Pointer chasing is generally slower than
accessing data that’s already nearby in memory, especially when you’re
doing it millions of times in a tight loop.

His optimization is simple but effective:
- For names that are less than 16 bytes long, inline the name directly.
- Only fall back to the mmap slice for longer names.

Let's try it:

```rust
const INLINE_NAME_CAP: usize = 16;

#[derive(Copy, Clone)]
struct Entry {
    w0: usize,
    w1: usize,
    min: i16,
    max: i16,
    sum: i32,
    count: u32,

    name_offset: usize, // offset relative to full mmap
    name_len: u8,
    // introduce an inline_name field
    inline_name: [u8; INLINE_NAME_CAP],
}
```

With some new methods:

```rust
impl Entry {
    fn new(w0: usize, w1: usize, temperature: i16, name_len: u8) -> Self {
        Self {
            w0,
            w1,
            min: temperature,
            max: temperature,
            sum: temperature as i32,
            count: 1,
            name_len,
            inline_name: [0; INLINE_NAME_CAP],
            name_offset: 0,
        }
    }

    #[inline(always)]
    fn update(&mut self, temperature: i16) {
        self.min = self.min.min(temperature);
        self.max = self.max.max(temperature);
        self.sum += temperature as i32;
        self.count += 1;
    }

    #[inline(always)]
    fn write_inline_name(&mut self, station: &[u8], map: &[u8]) {
        // we can just read the inline name if it's less than 16 bytes
        if station.len() < INLINE_NAME_CAP {
            self.inline_name[..station.len()].copy_from_slice(station);
        } else {
            // this is to hint the compiler that this case is "cold", or
            // unlikely to be executed so it can optimize it away
            std::hint::cold_path();
            self.name_offset = unsafe { station.as_ptr().offset_from(map.as_ptr()) as usize };
        };
    }

    #[inline(always)]
    fn entry_name_eq(&self, station: &[u8], map: &[u8]) -> bool {
        if station.len() < INLINE_NAME_CAP {
            &self.inline_name[..station.len()] == station
        } else {
            std::hint::cold_path();
            let existing = unsafe {
                map.get_unchecked(
                    self.name_offset as usize..self.name_offset as usize + station.len(),
                )
            };
            existing == station
        }
    }
}
```

Then the main logic changed a bit:

```rust
fn thread_insert_or_update(
    entries: &mut [Option<Entry>],
    station: &[u8],
    temperature: i32,
    map: &[u8], // full mmap for offset calculations
) {
    // ...
    loop {
        match &mut entries[idx] {
            // empty slot -> insert
            None => {
                let mut e = Entry::new(w0, w1, temperature, len as u8);
                e.write_inline_name(station, map);
                entries[idx] = Some(e);

                return;
            }
            Some(e) => {
                // check first 16 bytes, fast reject if collision
                if e.name_len as usize != len || e.w0 != w0 || e.w1 != w1 {
                    idx = (idx + STEP) & mask;
                    continue;
                }

                // check for name match
                if !e.entry_name_eq(station, map) {
                    idx = (idx + STEP) & mask;
                    continue;
                }

                // exist, update entry
                e.update(temperature);
                return;
            }
        }
    }
}
```

When merging the results:

```rust
let mut final_map: BTreeMap<&[u8], Entry> = BTreeMap::new();
for thread_entries_result in &results {
    for entry in thread_entries_result {
        let len = entry.name_len as usize;
        // we can just read the inline name if it's less than 16 bytes
        let name_bytes = if len < INLINE_NAME_CAP {
            &entry.inline_name[..len]
        } else {
            std::hint::cold_path();
            unsafe {
                map.get_unchecked(entry.name_offset as usize..entry.name_offset as usize + len)
            }
        };

        if let Some(existing) = final_map.get_mut(name_bytes) {
            existing.min = existing.min.min(entry.min);
            existing.max = existing.max.max(entry.max);
            existing.sum += entry.sum;
            existing.count += entry.count;
        } else {
            final_map.insert(name_bytes, *entry);
        }
    }
}
```

### "Branchlessly" temperature parsing

This is also a good chance to refactor some code and make it more
efficient. First the temperature parsing, make it a little more
"branchlessly":

```rust
fn parse_temperature(t: &[u8]) -> i16 {
    let mut i = 0;
    let neg = (t[0] == b'-') as i16;
    i += neg as usize;

    // first digit
    let d0 = (t[i] - b'0') as i16;

    // check if there are two digits before the dot: DD.D vs D.D
    let two_digits = (t[i + 1] != b'.') as i16;

    // second digit (= first digit if two_digits == 0)
    let d1 = (t[i + two_digits as usize] - b'0') as i16;

    let frac = (t[i + two_digits as usize + 2] - b'0') as i16;
    let int_part = d0 * (1 + 9 * two_digits) + d1 * two_digits;
    let val = int_part * 10 + frac;
    val - (neg * val * 2)
}
```

### Bit masking for first 16 bytes name packing

Before I mentioned that I was going to improve how I packed the first 16
bytes of the name into two usize values with bit masking. It's important
to note that the mask assumes little endian (since I'm running on a
x86_64 machine), so it is required to place the bytes in the right order.

```rust
const MASK_TABLE: [u64; 9] = [
    0x0000000000000000,
    0x00000000000000FF,
    0x000000000000FFFF,
    0x0000000000FFFFFF,
    0x00000000FFFFFFFF,
    0x000000FFFFFFFFFF,
    0x0000FFFFFFFFFFFF,
    0x00FFFFFFFFFFFFFF,
    0xFFFFFFFFFFFFFFFF,
];

#[inline(always)]
unsafe fn load_u64_masked(ptr: *const u8, len: usize) -> u64 {
    unsafe {
        let v = core::ptr::read_unaligned(ptr as *const u64);
        // use the length to index into a table of masks
        // branchless and avoids bit shift
        // e.g: If len is 3, we still read 8 bytes, 3 bytes are good data, the remanining 5 is
        // garbage. We need to mask it with the masks table
        // so len 3 gives us 0x0000000000FFFFFF -> keeps the first 3 bytes
        v & *MASK_TABLE.get_unchecked(len.min(8))
    }
}

// and use it like so
let w0 = unsafe { load_u64_masked(bytes, len.min(8)) } as usize;
let w1 = unsafe { load_u64_masked(bytes.add(8), len.saturating_sub(8).min(8)) } as usize;
```

All the change above brought the total runtime down to `~2.35s`, with a
total speedup of `~67.83x`. Honestly, that number surprised me because
I wasn't expecting it to be that much faster.

And with that… I was finally satisfied.

## Reflective + takeaways

At this point, I decided to stop. I was happy to have met all the goals
I set for myself. This exercise wasn’t really about shaving off the last
few milliseconds, it was an opportunity for me to learn more about Rust
and low level programming, and I'm glad I was able to do that.

Will this all be useful to me in the future? Almost certainly, though
maybe not in the ways I expect. Most production systems don’t need this
level of optimization, but knowing how and where performance is won makes
it much easier to reason about slow paths and choose the right
ones.

I’ll be carrying these lessons forward into future projects, and if
nothing else, this was a great reminder of why digging a bit deeper into
systems programming is so rewarding.

## My thanks

Thanks to [jonhoo](https://github.com/jonhoo) and [thomaswue](https://github.com/thomaswue)
for the inspiration and help with the optimizations.

[jonhoo](https://github.com/jonhoo) is an exceptional Rust programmer
and teacher, and I highly recommend checking out his [channel on
Youtube](https://www.youtube.com/@jonhoo).

## Appendix: Benchmarks

- Each version was run **5 times**.
- Calculate the **median** and **mean** runtime.
- Speedup is calculated relative to the baseline (v1).

| Version | Description                                     | Median Time (s)| Mean ± SD (s)   | Speedup (vs v1) |
|---------|-------------------------------------------------|----------------|-----------------|-----------------| 
| v1      | Naive version: BTreeMap                         | 159.40         | 161.68 ± 5.68   | 1.0x            |
| v2      | Normal HashMap with capacity                    | 85.16          | 85.54 ± 1.28    | 1.87x           |
| v3      | Lazy string allocate in HashMap key             | 73.17          | 73.15 ± 0.27    | 2.18x           |
| v4      | Vec<u8> as key + unchecked UTF-8 parse          | 59.24          | 59.30 ± 0.30    | 2.69x           |
| v5      | Parse temperature as i32                        | 55.08          | 55.18 ± 0.50    | 2.89x           |
| v6      | FNV-1a hasher                                   | 51.91          | 51.82 ± 0.23    | 3.07x           |
| v7      | mmap                                            | 33.50          | 33.42 ± 0.21    | 4.76x           |
| v8      | memchr                                          | 25.39          | 25.44 ± 0.13    | 6.28x           |
| v9      | Unroll temperature parsing                      | 23.37          | 23.43 ± 0.15    | 6.82x           |
| v10     | Better hashing, use Vec<> and manual collision detection instead of HashMap ([ref](https://github.com/gunnarmorling/1brc/blob/main/src/main/java/dev/morling/onebrc/CalculateAverage_thomaswue.java#L239)) | 21.06 | 21.05 ± 0.10 | 7.57x |
| v11     | Multi-threading                                 | 3.50           | 3.50 ± 0.02     | 45.54x          |
| v12     | Multi-threading + inline station name + better temperature parse + faster first 16 bytes load for name | 2.35 | 2.35 ± 0.05 | 67.83x |

