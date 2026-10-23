import { motion, useMotionValue } from 'framer-motion';
import React, { useEffect, useState } from 'react';

/**
 * A draggable cover carousel with thumbnail indicators.
 *
 * Adapted from the shadcn/21st.dev component for this Vite app: `next/image` is replaced with a
 * plain `img` (there is no Next image loader here), the slide/thumbnail art is supplied by the
 * caller, and the active index is reported so a page can render a caption or a link for the
 * cover in view. Everything else - the spring drag, the auto-advance, the scale difference
 * between active and inactive slides, the thumbnails - is the original behaviour.
 */

// ---- Customize here ----
const DEFAULT_IMAGES: ThumbnailCarouselItem[] = [
  {
    src: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=900&q=80',
    alt: 'Film camera on a sound stage',
  },
  {
    src: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80',
    alt: 'Empty cinema seats facing the screen',
  },
  {
    src: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?auto=format&fit=crop&w=900&q=80',
    alt: 'Film reels stacked on a shelf',
  },
  {
    src: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=900&q=80',
    alt: 'Projector casting light through a dark room',
  },
  {
    src: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=80',
    alt: 'Cinema screen glowing in an auditorium',
  },
  {
    src: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=900&q=80',
    alt: 'Clapperboard resting on a table',
  },
  {
    src: 'https://images.unsplash.com/photo-1574267432553-4b4628081c31?auto=format&fit=crop&w=900&q=80',
    alt: 'Film slate held in front of a camera',
  },
];

const ONE_SECOND = 1000;
const DEFAULT_AUTO_DELAY = ONE_SECOND * 5; // time between auto-advances (ms)
const DRAG_BUFFER = 50; // how far (px) user must drag to change slide

const SPRING_OPTIONS = {
  type: 'spring' as const,
  mass: 3,
  stiffness: 400,
  damping: 50,
};

// Slide size (Tailwind classes)
const SLIDE_SIZE_CLASSES = 'w-[320px] sm:w-[384px] h-[320px] sm:h-[384px]';
const SLIDE_WIDTH_CLASSES = 'w-[320px] sm:w-[384px]'; // outer wrapper (no height)

// Scale applied to active vs. inactive slides
const ACTIVE_SCALE = 0.95;
const INACTIVE_SCALE = 0.85;

// Thumbnail size (Tailwind classes)
const THUMB_SIZE_CLASSES = 'h-11 w-11 sm:h-[52px] sm:w-[52px]';

// Active thumbnail border (ring) color
const ACTIVE_THUMB_RING_CLASSES = 'ring-2 ring-white/60';
// ---- End customize ----

export interface ThumbnailCarouselItem {
  src: string;
  alt?: string;
}

export interface ThumbnailCarouselProps {
  /** Covers to show. Omit for the bundled Unsplash set; pass `[]` to render nothing. */
  items?: ThumbnailCarouselItem[];
  /** Time between automatic advances while the reader is not dragging. */
  autoAdvanceMs?: number;
  /** Reports the active cover so the page can render a caption or a link. */
  onIndexChange?: (index: number) => void;
  className?: string;
}

export const ThumbnailCarousel: React.FC<ThumbnailCarouselProps> = ({
  items,
  autoAdvanceMs = DEFAULT_AUTO_DELAY,
  onIndexChange,
  className,
}) => {
  const slides = items ?? DEFAULT_IMAGES;
  const [imgIndex, setImgIndex] = useState(0);
  const dragX = useMotionValue(0);

  /*
   * The active index can outlive the array it indexes into: a page that replaces its covers
   * (a new search, a filtered catalogue) can shrink the list under a carousel that was on slide
   * six. Clamp back to the first cover rather than rendering nothing.
   */
  useEffect(() => {
    setImgIndex((index) => (index >= slides.length ? 0 : index));
  }, [slides.length]);

  useEffect(() => {
    onIndexChange?.(imgIndex);
  }, [imgIndex, onIndexChange]);

  useEffect(() => {
    if (slides.length < 2) return;

    const intervalRef = setInterval(() => {
      const x = dragX.get();

      if (x === 0) {
        setImgIndex((prevIndex) => (prevIndex === slides.length - 1 ? 0 : prevIndex + 1));
      }
    }, autoAdvanceMs);

    return () => clearInterval(intervalRef);
  }, [autoAdvanceMs, dragX, slides.length]);

  if (slides.length === 0) return null;

  const onDragEnd = () => {
    const x = dragX.get();

    if (x <= -DRAG_BUFFER && imgIndex < slides.length - 1) {
      setImgIndex((prevIndex) => prevIndex + 1);
    } else if (x >= DRAG_BUFFER && imgIndex > 0) {
      setImgIndex((prevIndex) => prevIndex - 1);
    }
  };

  return (
    <div
      className={['flex select-none items-center justify-center overflow-hidden py-2', className]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured titles"
    >
      <div className={`relative ${SLIDE_WIDTH_CLASSES} py-4`}>
        <div className="relative overflow-hidden">
          <motion.div
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            style={{ x: dragX }}
            animate={{ translateX: `-${imgIndex * 100}%` }}
            transition={SPRING_OPTIONS}
            onDragEnd={onDragEnd}
            className="flex"
          >
            <Images slides={slides} imgIndex={imgIndex} />
          </motion.div>
        </div>

        <ThumbnailIndicators slides={slides} imgIndex={imgIndex} setImgIndex={setImgIndex} />
      </div>
    </div>
  );
};

interface ImagesProps {
  slides: ThumbnailCarouselItem[];
  imgIndex: number;
}

const Images: React.FC<ImagesProps> = ({ slides, imgIndex }) => {
  return (
    <>
      {slides.map((item, idx) => (
        <ImageItem key={`${item.src}-${idx}`} item={item} imgIndex={imgIndex} idx={idx} />
      ))}
    </>
  );
};

interface ImageItemProps {
  item: ThumbnailCarouselItem;
  imgIndex: number;
  idx: number;
}

const ImageItem: React.FC<ImageItemProps> = ({ item, imgIndex, idx }) => {
  return (
    <motion.div
      animate={{
        scale: imgIndex === idx ? ACTIVE_SCALE : INACTIVE_SCALE,
      }}
      transition={SPRING_OPTIONS}
      className={`relative ${SLIDE_SIZE_CLASSES} shrink-0 overflow-hidden rounded-2xl shadow-md dark:shadow-2xl`}
    >
      <img
        src={item.src}
        alt={item.alt ?? `Carousel slide ${idx + 1}`}
        className="absolute inset-0 h-full w-full object-cover"
        sizes="(max-width: 640px) 320px, 384px"
        loading={idx === 0 ? 'eager' : 'lazy'}
        draggable={false}
      />
    </motion.div>
  );
};

interface ThumbnailIndicatorsProps {
  slides: ThumbnailCarouselItem[];
  imgIndex: number;
  setImgIndex: React.Dispatch<React.SetStateAction<number>>;
}

const ThumbnailIndicators: React.FC<ThumbnailIndicatorsProps> = ({ slides, imgIndex, setImgIndex }) => {
  return (
    <div className="mt-4 flex items-center justify-center gap-2 overflow-x-auto overflow-y-visible p-1 pb-2">
      {slides.map((item, idx) => (
        <button
          key={`${item.src}-${idx}`}
          type="button"
          onClick={() => setImgIndex(idx)}
          aria-label={`Go to slide ${idx + 1}`}
          aria-current={idx === imgIndex ? 'true' : undefined}
          className={`relative ${THUMB_SIZE_CLASSES} shrink-0 cursor-pointer overflow-hidden rounded-lg border-0 bg-transparent p-0 transition-all duration-300 ${
            idx === imgIndex
              ? `scale-110 ${ACTIVE_THUMB_RING_CLASSES} shadow-md opacity-100`
              : 'opacity-60 hover:opacity-90'
          }`}
        >
          <img
            src={item.src}
            alt={`Thumbnail ${idx + 1}`}
            className="absolute inset-0 h-full w-full object-cover"
            sizes="52px"
            loading="lazy"
            draggable={false}
          />
        </button>
      ))}
    </div>
  );
};

export default ThumbnailCarousel;
