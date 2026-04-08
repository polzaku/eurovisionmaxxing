import { getAvatarUrl } from "@/lib/avatars";

interface AvatarProps {
  seed: string;
  size?: number; // px
  className?: string;
}

/**
 * DiceBear fun-emoji avatar.
 */
export default function Avatar({ seed, size = 48, className = "" }: AvatarProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getAvatarUrl(seed)}
      alt="Avatar"
      width={size}
      height={size}
      className={`rounded-full ${className}`}
    />
  );
}
